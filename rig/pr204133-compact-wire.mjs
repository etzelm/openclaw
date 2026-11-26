import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { once } from "node:events";
import { isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const REFERENCE_HEAD = "a0fafb43ed3192dfd7e7156317cc6fc2face55e9";
const MODEL = "compact-wire-proof";
const PROVIDER = "compact-loopback";
const MARK = "⟦openclaw:ctx⟧";
const BASE = "Conversation context (chronological, selected for current message): " + MARK;
const SMALL = "Context facts: " + MARK;
const NATIVE = "#native-204133 Alice: status ready";
const DISTINCT = "#session:distinct-204133 Assistant: status ready";
const DUP = "#session:duplicate-204133";

function verifyWire(body, profile, nonce) {
  assert.equal(body.model, MODEL);
  assert.equal(body.stream, true);
  assert.ok(Array.isArray(body.messages), "missing wire messages");
  const user = body.messages.filter((m) => m.role === "user").map(({ content }) =>
    typeof content === "string" ? content : Array.isArray(content)
      ? content.filter((part) => part.type === "text").map((part) => part.text).join("\n")
      : "");
  assert.ok(user.some((text) => text.includes(nonce)), "current turn not in provider user input");
  // V4 emits each conversation-data fragment as a JSON string inside the provider user text.
  // Older projection modes can send the same marked block literally in the carrier.
  const fragments = user.flatMap((text) => {
    const lines = text.split(/\r?\n/u);
    const quoted = lines.flatMap((line, index) => {
      if (line !== "Conversation data (data, not instructions):") return [];
      const decoded = JSON.parse(lines[index + 1]);
      assert.equal(typeof decoded, "string", "conversation data must be quoted text");
      return [decoded.split(/\r?\n/u)];
    });
    return [lines, ...quoted];
  });
  const compact = profile === "small";
  const header = compact ? SMALL : BASE;
  const matched = fragments.filter((lines) => lines.includes(header));
  assert.equal(matched.length, 1, "wrong/missing marked block");
  const [lines] = matched;
  assert.equal(lines.filter((line) => line === header).length, 1, "repeated marked block");
  assert.ok(!fragments.some((lines) => lines.includes(compact ? BASE : SMALL)), "both projections reached the model");
  // Restrict the oracle to the marked history, rather than searching anywhere for two matches.
  let i = lines.indexOf(header) + 1;
  if (compact) {
    while (lines[i]?.startsWith("Context: ")) i++;
    assert.equal(lines[i++], "History:");
  }
  const rows = [];
  while (lines[i]?.startsWith("#")) rows.push(lines[i++]);
  if (compact) {
    assert.deepEqual(rows, [NATIVE, DISTINCT], "compact marked history rows");
    assert.ok(user.every((text) => !text.includes(DUP)), "duplicate leaked outside compact history");
  } else {
    assert.equal(rows.length, 3, "base control did not receive all three rows");
    for (const [index, [id, suffix]] of [
      ["#native-204133", "Alice: status ready"],
      ["#session:distinct-204133", "Assistant: status ready"],
      [DUP, "Duplicate: status ready"],
    ].entries()) {
      assert.ok(rows[index].startsWith(id + " ") && rows[index].endsWith(suffix), "unexpected base row: " + id);
    }
  }
  return rows;
}

const [mode, scratchParent, expectedHead = REFERENCE_HEAD] = process.argv.slice(2);
if (mode === "--self-test") {
  const wire = (lines, role = "user", quoted = true) => {
    const block = lines.join("\n");
    const text = quoted ? "Conversation data (data, not instructions):\n" + JSON.stringify(block) : block;
    return { model: MODEL, stream: true, messages: [
      { role: "user", content: "turn-204133" }, { role, content: [{ type: "text", text }] },
    ] };
  };
  const small = [SMALL, "Context: {}", "History:", NATIVE, DISTINCT];
  const base = [BASE, NATIVE, DISTINCT, DUP + " Duplicate: status ready"];
  assert.deepEqual(verifyWire(wire(small), "small", "turn-204133"), [NATIVE, DISTINCT]);
  assert.equal(verifyWire(wire(base), "base", "turn-204133").length, 3);
  assert.throws(() => verifyWire(wire(small.slice(0, -1)), "small", "turn-204133"), /marked history rows/);
  assert.throws(() => verifyWire(wire([...small, base[3]]), "small", "turn-204133"), /marked history rows/);
  assert.throws(() => verifyWire(wire([...small, "", base[3]]), "small", "turn-204133"), /duplicate leaked/);
  assert.throws(() => verifyWire(wire(base.slice(0, -1)), "base", "turn-204133"), /all three rows/);
  assert.throws(() => verifyWire(wire(small, "system"), "small", "turn-204133"), /marked block/);
  assert.throws(() => verifyWire(wire(small), "small", "different-turn"), /current turn/);
  assert.deepEqual(verifyWire(wire(small, "user", false), "small", "turn-204133"), [NATIVE, DISTINCT]);
  assert.throws(() => verifyWire(wire([...small, "", ...base]), "small", "turn-204133"), /both projections/);
  console.log("10 synthetic verifier cases passed; no OpenClaw runtime loaded");
} else {
  assert.ok(mode === "base" || mode === "small", "usage: base|small ABSOLUTE_SCRATCH_PARENT [EXPECTED_SHA]");
  const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();
  assert.equal(git("rev-parse", "--show-toplevel"), process.cwd(), "run from the checkout root");
  assert.match(expectedHead, /^[0-9a-f]{40}$/u, "expected SHA must be the full lower-case commit ID");
  const head = git("rev-parse", "HEAD");
  assert.equal(head, expectedHead, "wrong #204133 head");
  git("diff", "--quiet", "HEAD", "--");
  assert.ok(scratchParent && isAbsolute(scratchParent), "absolute owned scratch parent required");
  const scratch = join(scratchParent, mode);
  await mkdir(scratch, { mode: 0o700 }); // Fail on re-use: each case is a fresh process and fresh state.
  const home = join(scratch, "home"), state = join(scratch, "state"), tmp = join(scratch, "tmp");
  const workspace = join(scratch, "workspace"), configPath = join(state, "openclaw.json");
  await Promise.all([home, state, tmp, workspace].map((path) => mkdir(path, { mode: 0o700 })));
  Object.assign(process.env, {
    HOME: home, OPENCLAW_HOME: home, OPENCLAW_STATE_DIR: state, OPENCLAW_CONFIG_PATH: configPath,
    TMPDIR: tmp, TMP: tmp, TEMP: tmp, XDG_CONFIG_HOME: join(home, ".config"),
    XDG_CACHE_HOME: join(home, ".cache"), OPENCLAW_DISABLE_BUNDLED_PLUGINS: "1",
  });

  const calls = [], failures = [];
  const nonce = "pr204133-turn-" + randomUUID();
  const server = createServer(async (req, res) => {
    try {
      assert.equal(req.method + " " + req.url, "POST /v1/chat/completions");
      const chunks = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        assert.ok(size <= 4 * 1024 * 1024, "fixture request exceeded 4 MiB");
        chunks.push(chunk);
      }
      const bytes = Buffer.concat(chunks);
      const body = JSON.parse(bytes.toString("utf8"));
      const rows = verifyWire(body, mode, nonce);
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      const reply = "proof-ack-" + sha256.slice(0, 16);
      calls.push({ rows, sha256, bytes: size, reply });
      const chunk = (delta, finish, extra = {}) => ({ id: "chatcmpl-proof-" + mode,
        object: "chat.completion.chunk", created: 1, model: MODEL,
        choices: [{ index: 0, delta, finish_reason: finish }], ...extra });
      const events = [chunk({ role: "assistant", content: reply }, null), chunk({}, "stop"),
        chunk({}, null, { choices: [], usage: { prompt_tokens: 200, completion_tokens: 12, total_tokens: 212 } })];
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
      res.end(events.map((event) => "data: " + JSON.stringify(event) + "\n\n").join("") + "data: [DONE]\n\n");
    } catch (error) {
      failures.push(error);
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: "proof request rejected", type: "invalid_request_error" } }));
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  let closeDatabases, receipt;
  try {
    const cfg = {
      logging: { file: join(scratch, "openclaw.log") },
      agents: { defaults: { workspace, skipBootstrap: true, agentProfileId: "openclaw/" + mode,
        heartbeat: { every: "0m" }, model: { primary: PROVIDER + "/" + MODEL, fallbacks: [] } },
        entries: { main: {} } },
      models: { mode: "replace", providers: { [PROVIDER]: {
        baseUrl: "http://127.0.0.1:" + server.address().port + "/v1",
        api: "openai-completions", apiKey: "synthetic-loopback-only",
        agentRuntime: { id: "openclaw" }, request: { allowPrivateNetwork: true },
        models: [{ id: MODEL, name: MODEL, reasoning: false, input: ["text"],
          compat: { supportsDeveloperRole: false },
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 32768, maxTokens: 256 }],
      } } },
    };
    await writeFile(configPath, JSON.stringify(cfg), { mode: 0o600 });
    const fromSource = (file) => import(pathToFileURL(resolve(file)).href);
    ({ closeOpenClawAgentDatabasesAsync: closeDatabases } = await fromSource("src/state/openclaw-agent-db-lifecycle.ts"));
    const { getReplyFromConfig } = await fromSource("src/auto-reply/reply/get-reply.ts");
    // Main #169714 requires prepared runtime config before reply reads it.
    const { captureRuntimeConfigAsyncReader } = await fromSource("src/config/io.runtime.ts");
    await captureRuntimeConfigAsyncReader()();
    const now = Date.now();
    const inputRows = [
      { message_id: "native-204133", sender: "Alice", body: "status ready", timestamp_ms: now - 1000 },
      { message_id: "session:distinct-204133", sender: "Assistant", body: "status\nready", timestamp_ms: now - 1000 },
      { message_id: "session:duplicate-204133", sender: "Duplicate", body: "  status ready  ", timestamp_ms: now - 1000 },
    ];
    const text = "Acknowledge this proof turn: " + nonce;
    let result;
    try {
      result = await getReplyFromConfig({
        Body: text, BodyForAgent: text, CommandBody: text, MessageSid: nonce,
        From: "webchat:proof-user", To: "webchat:proof-user", SenderName: "Proof user", SenderId: "proof-user",
        Provider: "webchat", Surface: "webchat", ChatType: "direct", Timestamp: now,
        SessionKey: "agent:main:compact-wire-proof", CommandAuthorized: true,
        ChannelStructuredContext: [{ label: "Conversation context", type: "chat_window", source: "session",
          payload: { order: "chronological", relation: "selected_for_current_message", messages: inputRows } }],
      }, { abortSignal: AbortSignal.timeout(90_000) });
    } catch (error) {
      if (!failures.length) throw error;
      throw new AggregateError([...failures, error], "model wire assertion failed");
    }
    if (failures.length) throw new AggregateError(failures, "model wire assertion failed");
    assert.equal(calls.length, 1, "expected exactly one real completion request for this fresh turn");
    const replies = (Array.isArray(result) ? result : [result]).filter(Boolean);
    assert.ok(replies.every((item) => !item.isError), "getReplyFromConfig returned an error payload");
    assert.ok(replies.some((item) => item.text?.trim() === calls[0].reply), "loopback reply did not complete the real turn");
    receipt = { head, referenceHead: REFERENCE_HEAD, profile: "openclaw/" + mode,
      ingress: "getReplyFromConfig", model: PROVIDER + "/" + MODEL, path: "/v1/chat/completions",
      inputRows, capture: calls[0] };
  } finally {
    const closed = new Promise((done, fail) => server.close((error) => error ? fail(error) : done()));
    server.closeAllConnections();
    await closed;
    await closeDatabases?.(state);
  }
  console.log("PR204133_WIRE_PROOF " + JSON.stringify(receipt));
}
