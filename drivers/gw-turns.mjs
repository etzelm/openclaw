// Starts a Gateway on an existing isolated profile and drives three turns for the system agent main:
// an operator turn (chat.send), an agent RPC turn, and a forced isolated cron run. Reads the working
// directory and injected SOUL.md from the request the mock provider received. With --inspect it also
// lists main's stored sessions and the agent:main:main chat history before and after the turns.
// --dist selects the installed package that runs the Gateway (default: --repo, a source build).
// usage: node --import <repo>/scripts/tsx.mjs gw-turns.mjs --repo <repo> [--dist <pkg>] --root <profile> --port <port> --label <label> [--inspect]
import { spawn } from "node:child_process";
import { openSync, closeSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { randomUUID } from "node:crypto";

const { values } = parseArgs({ options: { repo: { type: "string" }, dist: { type: "string" }, root: { type: "string" }, port: { type: "string" }, label: { type: "string" }, inspect: { type: "boolean" }, env: { type: "string", multiple: true } } });
const repo = path.resolve(values.repo);
const dist = path.resolve(values.dist ?? values.repo);
const root = path.resolve(values.root);
const port = Number(values.port);
const imp = (base, p) => import(pathToFileURL(path.join(base, p)).href);
const { createGatewayWsClient } = await imp(repo, "scripts/lib/gateway-ws-client.ts");
const { createGatewayBenchEnv } = await imp(repo, "scripts/lib/gateway-bench-runtime.ts");
const { PROTOCOL_VERSION } = await imp(dist, "dist/gateway/protocol/index.js");

const configPath = path.join(root, "openclaw.json");
const control = path.join(root, "mock-control.json");
const reqLog = path.join(root, `mock-requests-${values.label}.jsonl`);
writeFileSync(control, JSON.stringify({ text: "PROOF-REPLY" }));
writeFileSync(reqLog, "");
const env = createGatewayBenchEnv(root, configPath, {
  startupTrace: false,
  caseEnv: {
    OPENAI_API_KEY: "synthetic-proof-not-a-real-key",
    ...Object.fromEntries((values.env ?? []).map((kv) => [kv.slice(0, kv.indexOf("=")), kv.slice(kv.indexOf("=") + 1)])),
    PATH: `${path.dirname(process.execPath)}:${process.env.PATH}`,
    TMPDIR: root,
    MOCK_PORT: String(port + 1),
    MOCK_BIND_HOST: "127.0.0.1",
    MOCK_RESPONSE_CONTROL: control,
    MOCK_REQUEST_LOG: reqLog,
  },
});
const children = [];
function start(args, label, cwd) {
  const fd = openSync(path.join(root, `${label}-${values.label}.log`), "wx");
  const child = spawn(process.execPath, args, { cwd, env, detached: true, stdio: ["ignore", fd, fd] });
  closeSync(fd);
  children.push(child);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const requests = () => readFileSync(reqLog, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
let client;
const out = [];
const redact = (s) => String(s).split(root).join("<profile>");
try {
  start([path.join(repo, "scripts/e2e/mock-openai-server.mjs")], "mock", repo);
  start(["dist/index.js", "gateway", "--port", String(port)], "gateway", dist);
  const deadline = Date.now() + 300000;
  while (!client && Date.now() < deadline) {
    const c = createGatewayWsClient({ url: `ws://127.0.0.1:${port}`, onEvent: () => {} });
    try {
      await c.waitOpen();
      const res = await c.request("connect", {
        minProtocol: PROTOCOL_VERSION, maxProtocol: PROTOCOL_VERSION,
        client: { id: "gateway-client", displayName: "proof", version: "1", platform: process.platform, mode: "backend" },
        role: "operator", scopes: ["operator.read", "operator.write", "operator.admin"], caps: [],
      }, 20000);
      if (!res.ok) throw new Error(JSON.stringify(res.error));
      client = c;
    } catch { try { c.close(); } catch {} await sleep(1000); }
  }
  if (!client) throw new Error("gateway did not become ready");
  // Sessions open after the Gateway's background startup inspection; retry what it marks retryable.
  const rpc = async (m, p, t = 120000) => {
    for (let attempt = 0; ; attempt++) {
      const r = await client.request(m, p, t);
      if (r.ok) return r.payload;
      if (!r.error?.retryable || attempt >= 240) throw new Error(`${m}: ${JSON.stringify(r.error)}`);
      await sleep(Math.max(250, r.error.retryAfterMs ?? 250));
    }
  };
  const status = await rpc("status", {}).catch((e) => ({ error: e.message }));
  console.log(`## gateway ${values.label}: version ${status?.version ?? status?.runtimeVersion ?? JSON.stringify(status).match(/"version":"([^"]+)"/)?.[1] ?? "?"}`);
  const inspect = async (when) => {
    if (!values.inspect) return;
    const list = await rpc("sessions.list", { limit: 100 }).catch((e) => ({ error: e.message }));
    const keys = (list.sessions ?? []).map((s) => s.key).filter((k) => k.startsWith("agent:main:")).sort();
    const hist = await rpc("chat.history", { sessionKey: "agent:main:main", limit: 200 }).catch((e) => ({ error: e.message }));
    const msgs = hist.messages ?? [];
    const texts = msgs.map((m) => {
      const c = m.content ?? m.text;
      const t = typeof c === "string" ? c : Array.isArray(c) ? c.map((p) => p.text ?? "").join("") : JSON.stringify(c ?? "");
      return `${m.role}: ${t.replace(/\s+/g, " ").slice(0, 60)}`;
    });
    console.log(`## ${when}: sessions of main (${keys.length}): ${keys.join(", ") || list.error || "none"}`);
    console.log(`## ${when}: chat.history agent:main:main has ${msgs.length} messages${hist.error ? ` (error ${redact(hist.error)})` : ""}`);
    for (const t of texts) console.log(`   ${redact(t)}`);
  };
  await inspect("stored before the turns");
  const turns = [
    ["operator turn (chat.send, session agent:main:main)", "operator turn", async (text) => rpc("chat.send", { sessionKey: "agent:main:main", message: text, idempotencyKey: randomUUID() })],
    ["agent RPC turn (session agent:main:wake-proof)", "wake turn", async (text) => {
      const runId = randomUUID();
      await rpc("agent", { sessionKey: "agent:main:wake-proof", message: text, deliver: false, idempotencyKey: runId });
      await rpc("agent.wait", { runId, timeoutMs: 120000 }, 130000);
    }],
    ["scheduled turn (cron.add isolated agentTurn for main, cron.run force)", "cron turn", async (text) => {
      const job = await rpc("cron.add", { name: `workspace-proof-${values.label}`, agentId: "main", schedule: { kind: "every", everyMs: 86400000 }, sessionTarget: "isolated", wakeMode: "now", payload: { kind: "agentTurn", message: text } });
      const id = job.id ?? job.job?.id ?? job.jobId;
      await rpc("cron.run", { id, mode: "force", waitTimeoutMs: 120000 }, 130000);
    }],
  ];
  for (const [name, prefix, run] of turns) {
    const text = `${prefix} ${values.label}: say PROOF-REPLY`;
    const before = requests().length;
    try { await run(text); } catch (e) { out.push({ name, error: redact(e.message) }); continue; }
    const findRec = () => requests().slice(before).find((r) => typeof r.body === "string" && r.body.includes(text) && JSON.parse(r.body).tools);
    for (let i = 0; i < 120 && !findRec(); i++) await sleep(500);
    const rec = findRec();
    if (!rec) { out.push({ name, error: "no agent-turn provider request carrying the turn text" }); continue; }
    const body = redact(rec.body).replaceAll("\\n", "\n");
    const workingDirectory = body.match(/Working directory: ([^\n"\\]+)/)?.[1];
    const soul = ["ROOT-SOUL", "SUBDIR-SOUL", "SUBDIR-AGENTS", "MOVED-SOUL"].filter((m) => body.includes(`PROOF-MARKER-${m}`)).map((m) => `PROOF-MARKER-${m}`);
    const bootstrapFiles = [...new Set(body.match(/<profile>\/(?:workspace|moved)(?:\/main)?\/(?:SOUL|AGENTS|IDENTITY|USER|MEMORY)\.md/g) ?? [])];
    const priorTurnsInPrompt = (body.match(/operator turn [a-z0-9-]+: say PROOF-REPLY/g) ?? []).filter((t) => !t.includes(values.label));
    out.push({ name, workingDirectory, soulMarkersInjected: soul.length ? soul : ["none (template persona)"], bootstrapFiles, ...(name.startsWith("operator") ? { earlierTurnsReplayedToProvider: [...new Set(priorTurnsInPrompt)] } : {}) });
  }
  for (const o of out) console.log(JSON.stringify(o, null, 2));
  await sleep(1500);
  await inspect("after the turns");
} finally {
  try { client?.close(); } catch {}
  for (const c of children) { try { process.kill(-c.pid, "SIGTERM"); } catch {} }
  await sleep(1500);
}
