// Isolated-profile Gateway proof: one operator turn (chat.send) and one wake-style turn (agent RPC)
// for the designated system agent of a converged explicit roster, against a scripted mock provider.
// usage: node --import <repo>/scripts/tsx.mjs gateway-proof.mjs --repo <repo> --root <new dir> --port <port> --label <label>
import { spawn } from "node:child_process";
import { mkdirSync, openSync, closeSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { randomUUID } from "node:crypto";

const { values } = parseArgs({
  options: { repo: { type: "string" }, root: { type: "string" }, port: { type: "string" }, label: { type: "string" }, system: { type: "string", default: "main" } },
});
const repo = path.resolve(values.repo);
const root = path.resolve(values.root);
const port = Number(values.port);
const imp = (p) => import(pathToFileURL(path.join(repo, p)).href);
const { createGatewayWsClient } = await imp("scripts/lib/gateway-ws-client.ts");
const { BASE_GATEWAY_BENCH_CONFIG, createGatewayBenchEnv } = await imp("scripts/lib/gateway-bench-runtime.ts");
const { applyMockOpenAiModelConfig } = await imp("scripts/e2e/lib/fixtures/mock-openai-config.mjs");
const { PROTOCOL_VERSION } = await imp("dist/gateway/protocol/index.js");

mkdirSync(root);
const shared = path.join(root, "workspace");
mkdirSync(path.join(shared, values.system), { recursive: true });
writeFileSync(path.join(shared, "SOUL.md"), "PROOF-MARKER-SHARED-ROOT-SOUL: persona kept in the shared workspace root.\n");
writeFileSync(path.join(shared, values.system, "SOUL.md"), "PROOF-MARKER-SUBDIR-SOUL: blank scaffold persona.\n");

const config = structuredClone(BASE_GATEWAY_BENCH_CONFIG);
config.cron = { enabled: false };
config.memory = { search: { enabled: false } };
config.plugins.slots = { memory: "none" };
applyMockOpenAiModelConfig(config, { mockPort: port + 1 });
config.agents.defaults = {
  ...config.agents.defaults,
  workspace: shared,
  heartbeat: { every: "0m" },
  skills: [],
  modelPolicy: {},
  systemAgent: { agentId: values.system },
};
config.agents.ownership = "explicit";
config.agents.entries = { main: {}, research: {}, dev: {} };
const configPath = path.join(root, "openclaw.json");
writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
const control = path.join(root, "mock-control.json");
const reqLog = path.join(root, "mock-requests.jsonl");
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
  const fd = openSync(path.join(root, `${label}.log`), "wx");
  const child = spawn(process.execPath, args, { cwd: repo, env, detached: true, stdio: ["ignore", fd, fd] });
  closeSync(fd);
  children.push(child);
  return child;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const requests = () => readFileSync(reqLog, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
async function waitRequests(count, ms = 120000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (requests().length >= count) return;
    await sleep(500);
  }
  throw new Error(`mock provider saw ${requests().length} requests, wanted ${count}`);
}
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
    [`operator turn (chat.send, session agent:${values.system}:main)`, async () => rpc("chat.send", { sessionKey: `agent:${values.system}:main`, message: "operator turn: say PROOF-REPLY", idempotencyKey: randomUUID() })],
    [`agent RPC turn (session agent:${values.system}:wake-proof)`, async () => {
      const runId = randomUUID();
      await rpc("agent", { sessionKey: `agent:${values.system}:wake-proof`, message: "wake turn: say PROOF-REPLY", deliver: false, idempotencyKey: runId });
      await rpc("agent.wait", { runId, timeoutMs: 120000 }, 130000);
    }],
  ];
  for (const [name, run] of turns) {
    const before = requests().length;
    await run();
    const findRec = () => requests().slice(before).find((r) => typeof r.body === "string" && r.body.includes("tools") && /turn: say PROOF-REPLY/.test(r.body) && JSON.parse(r.body).tools);
    for (let i = 0; i < 120 && !findRec(); i++) await sleep(500);
    await sleep(1000);
    const rec = findRec();
    if (!rec) { out.push({ name, error: "no agent-turn provider request carrying the turn text" }); continue; }
    const text = redact(rec.body).replaceAll("\\n", "\n");
    const workingDirectory = text.match(/Working directory: ([^\n"\\]+)/)?.[1];
    const bootstrapFiles = [...new Set(text.match(/<profile>\/workspace[^\s"\\`)]*\/(?:SOUL|AGENTS|IDENTITY|USER)\.md|<profile>\/workspace\/(?:SOUL|AGENTS|IDENTITY|USER)\.md/g) ?? [])];
    const soul = text.includes("PROOF-MARKER-SHARED-ROOT-SOUL") ? "shared root SOUL.md (PROOF-MARKER-SHARED-ROOT-SOUL)" : text.includes("PROOF-MARKER-SUBDIR-SOUL") ? "subdirectory SOUL.md (PROOF-MARKER-SUBDIR-SOUL)" : "none";
    out.push({ name, workingDirectory, bootstrapFiles, soulInjected: soul });
  }
  const sess = await rpc("sessions.list", { limit: 20 }).catch((e) => ({ error: String(e) }));
  console.log(`## ${values.label}`);
  console.log(`roster: ownership=explicit systemAgent=${values.system} defaults.workspace=<profile>/workspace entries main, research, dev (no authored workspace)`);
  for (const o of out) console.log(JSON.stringify(o, null, 2));
  writeFileSync(path.join(root, "result.json"), redact(JSON.stringify({ out, sess }, null, 2)));
} finally {
  try { client?.close(); } catch {}
  for (const c of children) { try { process.kill(-c.pid, "SIGTERM"); } catch {} }
  await sleep(500);
}
