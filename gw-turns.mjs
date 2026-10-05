// Starts the built Gateway on an existing isolated profile and drives three turns for the system
// agent main: an operator turn (chat.send), an agent RPC turn, and a forced isolated cron run.
// Reads the working directory and injected SOUL.md from the request the mock provider received.
// usage: node --import <repo>/scripts/tsx.mjs gw-turns.mjs --repo <repo> --root <profile> --port <port> --label <label>
import { spawn } from "node:child_process";
import { openSync, closeSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { randomUUID } from "node:crypto";

const { values } = parseArgs({ options: { repo: { type: "string" }, root: { type: "string" }, port: { type: "string" }, label: { type: "string" } } });
const repo = path.resolve(values.repo);
const root = path.resolve(values.root);
const port = Number(values.port);
const imp = (p) => import(pathToFileURL(path.join(repo, p)).href);
const { createGatewayWsClient } = await imp("scripts/lib/gateway-ws-client.ts");
const { createGatewayBenchEnv } = await imp("scripts/lib/gateway-bench-runtime.ts");
const { PROTOCOL_VERSION } = await imp("dist/gateway/protocol/index.js");

const configPath = path.join(root, "openclaw.json");
const control = path.join(root, "mock-control.json");
const reqLog = path.join(root, `mock-requests-${values.label}.jsonl`);
writeFileSync(control, JSON.stringify({ text: "PROOF-REPLY" }));
writeFileSync(reqLog, "");
const env = createGatewayBenchEnv(root, configPath, {
  startupTrace: false,
  caseEnv: {
    OPENAI_API_KEY: "synthetic-proof-not-a-real-key",
    PATH: `${path.dirname(process.execPath)}:${process.env.PATH}`,
    TMPDIR: root,
    MOCK_PORT: String(port + 1),
    MOCK_BIND_HOST: "127.0.0.1",
    MOCK_RESPONSE_CONTROL: control,
    MOCK_REQUEST_LOG: reqLog,
  },
});
const children = [];
function start(args, label) {
  const fd = openSync(path.join(root, `${label}-${values.label}.log`), "wx");
  const child = spawn(process.execPath, args, { cwd: repo, env, detached: true, stdio: ["ignore", fd, fd] });
  closeSync(fd);
  children.push(child);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const requests = () => readFileSync(reqLog, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
let client;
const out = [];
const redact = (s) => String(s).split(root).join("<profile>");
try {
  start(["scripts/e2e/mock-openai-server.mjs"], "mock");
  start(["dist/index.js", "gateway", "--port", String(port)], "gateway");
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
  const rpc = async (m, p, t = 120000) => { const r = await client.request(m, p, t); if (!r.ok) throw new Error(`${m}: ${JSON.stringify(r.error)}`); return r.payload; };
  const turns = [
    ["operator turn (chat.send, session agent:main:main)", "operator turn", async (text) => rpc("chat.send", { sessionKey: "agent:main:main", message: text, idempotencyKey: randomUUID() })],
    ["agent RPC turn (session agent:main:wake-proof)", "wake turn", async (text) => {
      const runId = randomUUID();
      await rpc("agent", { sessionKey: "agent:main:wake-proof", message: text, deliver: false, idempotencyKey: runId });
      await rpc("agent.wait", { runId, timeoutMs: 120000 }, 130000);
    }],
    ["scheduled turn (cron.add isolated agentTurn for main, cron.run force)", "cron turn", async (text) => {
      const job = await rpc("cron.add", { name: "workspace-proof", agentId: "main", schedule: { kind: "every", everyMs: 86400000 }, sessionTarget: "isolated", wakeMode: "now", payload: { kind: "agentTurn", message: text } });
      const id = job.id ?? job.job?.id ?? job.jobId;
      await rpc("cron.run", { id, mode: "force", waitTimeoutMs: 120000 }, 130000);
    }],
  ];
  for (const [name, prefix, run] of turns) {
    const text = `${prefix}: say PROOF-REPLY`;
    const before = requests().length;
    try { await run(text); } catch (e) { out.push({ name, error: redact(e.message) }); continue; }
    const findRec = () => requests().slice(before).find((r) => typeof r.body === "string" && r.body.includes(text) && JSON.parse(r.body).tools);
    for (let i = 0; i < 120 && !findRec(); i++) await sleep(500);
    const rec = findRec();
    if (!rec) { out.push({ name, error: "no agent-turn provider request carrying the turn text" }); continue; }
    const body = redact(rec.body).replaceAll("\\n", "\n");
    const workingDirectory = body.match(/Working directory: ([^\n"\\]+)/)?.[1];
    const soul = ["ROOT-SOUL", "SUBDIR-SOUL"].filter((m) => body.includes(`PROOF-MARKER-${m}`)).map((m) => `PROOF-MARKER-${m}`);
    const bootstrapFiles = [...new Set(body.match(/<profile>\/workspace(?:\/main)?\/(?:SOUL|AGENTS|IDENTITY|USER|MEMORY)\.md/g) ?? [])];
    out.push({ name, workingDirectory, soulMarkersInjected: soul.length ? soul : ["none (template persona)"], bootstrapFiles });
  }
  console.log(`## gateway ${values.label}`);
  for (const o of out) console.log(JSON.stringify(o, null, 2));
} finally {
  try { client?.close(); } catch {}
  for (const c of children) { try { process.kill(-c.pid, "SIGTERM"); } catch {} }
  await sleep(1000);
}
