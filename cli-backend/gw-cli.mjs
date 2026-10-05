// Starts the built Gateway on an existing isolated profile and drives three turns for the system
// agent main: an operator turn (chat.send), an agent RPC turn, and a forced isolated cron run.
// Reads the working directory and injected SOUL.md from the request the mock provider received.
// usage: node --import <repo>/scripts/tsx.mjs gw-turns.mjs --repo <repo> --root <profile> --port <port> --label <label>
import { spawn } from "node:child_process";
import { openSync, closeSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { randomUUID } from "node:crypto";

const { values } = parseArgs({ options: { repo: { type: "string" }, root: { type: "string" }, port: { type: "string" }, label: { type: "string" }, turns: { type: "string" }, env: { type: "string", multiple: true } } });
const repo = path.resolve(values.repo);
const root = path.resolve(values.root);
const port = Number(values.port);
const imp = (p) => import(pathToFileURL(path.join(repo, p)).href);
const { createGatewayWsClient } = await imp("scripts/lib/gateway-ws-client.ts");
const { createGatewayBenchEnv } = await imp("scripts/lib/gateway-bench-runtime.ts");
const { PROTOCOL_VERSION } = await imp("dist/gateway/protocol/index.js");

const configPath = path.join(root, "openclaw.json");
const stubLog = path.join(root, "stub.log");
const env = createGatewayBenchEnv(root, configPath, {
  startupTrace: false,
  caseEnv: {
    PATH: `${path.join(path.dirname(repo), "cli")}:${path.dirname(process.execPath)}:${process.env.PATH}`,
    TMPDIR: root,
    STUB_LOG: stubLog,
    ...Object.fromEntries((values.env ?? []).map((kv) => [kv.slice(0, kv.indexOf("=")), kv.slice(kv.indexOf("=") + 1)])),
  },
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fd = openSync(path.join(root, `gateway-${values.label}.log`), "wx");
const child = spawn(process.execPath, ["dist/index.js", "gateway", "--port", String(port)], { cwd: repo, env, detached: true, stdio: ["ignore", fd, fd] });
closeSync(fd);
let client;
try {
  const deadline = Date.now() + 300000;
  while (!client && Date.now() < deadline) {
    const c = createGatewayWsClient({ url: `ws://127.0.0.1:${port}`, onEvent: () => {} });
    try {
      await c.waitOpen();
      const res = await c.request("connect", { minProtocol: PROTOCOL_VERSION, maxProtocol: PROTOCOL_VERSION, client: { id: "gateway-client", displayName: "proof", version: "1", platform: process.platform, mode: "backend" }, role: "operator", scopes: ["operator.read", "operator.write", "operator.admin"], caps: [] }, 20000);
      if (!res.ok) throw new Error(JSON.stringify(res.error));
      client = c;
    } catch { try { c.close(); } catch {} await sleep(1000); }
  }
  if (!client) throw new Error("gateway did not become ready");
  const n = Number(values.turns ?? "1");
  for (let i = 1; i <= n; i++) {
    const tag = `turn-${values.label}-${i}`;
    const before = existsSync(stubLog) ? readFileSync(stubLog, "utf8").split("\n").filter(Boolean).length : 0;
    const r = await client.request("chat.send", { sessionKey: "agent:main:main", message: `${tag} say hello`, idempotencyKey: randomUUID() }, 120000);
    if (!r.ok) { console.log(`${tag}: chat.send error ${JSON.stringify(r.error)}`); continue; }
    let seen = false;
    for (let k = 0; k < 180 && !seen; k++) {
      const lines = existsSync(stubLog) ? readFileSync(stubLog, "utf8").split("\n").filter(Boolean).slice(before) : [];
      seen = lines.some((l) => l.includes(`"prompt":"${tag}"`));
      if (!seen) await sleep(500);
    }
    console.log(`${tag}: ${seen ? "stub received the turn" : "NO stub turn observed"}`);
    await sleep(1500);
  }
} finally {
  try { client?.close(); } catch {}
  try { process.kill(-child.pid, "SIGTERM"); } catch {}
  await sleep(1500);
}
