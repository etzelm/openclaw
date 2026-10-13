// Starts a Gateway on an existing isolated profile whose model runs on the claude-cli backend with
// the real Claude Code executable (--stubdir holds a `claude` link to it) and sends one operator
// turn per --message on agent:main:main, printing the assistant reply read back from chat.history.
// --dist selects the installed package that runs the Gateway (default: --repo, a source build).
// usage: node --import <repo>/scripts/tsx.mjs gw-cli.mjs --repo <repo> [--dist <pkg>] --stubdir <dir> --root <profile> --port <port> --label <label> --message <text> [--message <text>]
import { spawn } from "node:child_process";
import { openSync, closeSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { randomUUID } from "node:crypto";

const { values } = parseArgs({ options: { repo: { type: "string" }, dist: { type: "string" }, stubdir: { type: "string" }, root: { type: "string" }, port: { type: "string" }, label: { type: "string" }, turns: { type: "string" }, message: { type: "string", multiple: true }, env: { type: "string", multiple: true } } });
const repo = path.resolve(values.repo);
const dist = path.resolve(values.dist ?? values.repo);
const root = path.resolve(values.root);
const port = Number(values.port);
const imp = (base, p) => import(pathToFileURL(path.join(base, p)).href);
const { createGatewayWsClient } = await imp(repo, "scripts/lib/gateway-ws-client.ts");
const { createGatewayBenchEnv } = await imp(repo, "scripts/lib/gateway-bench-runtime.ts");
const { PROTOCOL_VERSION } = await imp(dist, "dist/gateway/protocol/index.js");

const configPath = path.join(root, "openclaw.json");
const stubLog = path.join(root, "stub.log");
const env = createGatewayBenchEnv(root, configPath, {
  startupTrace: false,
  caseEnv: {
    PATH: `${path.resolve(values.stubdir)}:${path.dirname(process.execPath)}:${process.env.PATH}`,
    TMPDIR: root,
    STUB_LOG: stubLog,
    ...Object.fromEntries((values.env ?? []).map((kv) => [kv.slice(0, kv.indexOf("=")), kv.slice(kv.indexOf("=") + 1)])),
  },
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fd = openSync(path.join(root, `gateway-${values.label}.log`), "wx");
const child = spawn(process.execPath, ["dist/index.js", "gateway", "--port", String(port)], { cwd: dist, env, detached: true, stdio: ["ignore", fd, fd] });
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
  const replyText = (m) => {
    const c = m?.content ?? m?.text;
    return typeof c === "string" ? c : Array.isArray(c) ? c.map((p) => p.text ?? "").join("") : "";
  };
  const history = async () => (await client.request("chat.history", { sessionKey: "agent:main:main", limit: 200 }, 20000)).payload?.messages ?? [];
  // No --message only lets the agent finish startup inspection, then stops the Gateway cleanly.
  if (!values.message?.length) await sleep(15000);
  for (const [i, message] of (values.message ?? []).entries()) {
    const tag = `turn-${values.label}-${i + 1}`;
    const before = (await history().catch(() => [])).length;
    // Sessions open once startup inspection finishes, after the listener binds.
    let r;
    for (let k = 0; k < 120; k++) {
      r = await client.request("chat.send", { sessionKey: "agent:main:main", message, idempotencyKey: randomUUID() }, 120000);
      if (r.ok || r.error?.code !== "UNAVAILABLE") break;
      await sleep(1000);
    }
    console.log(`${tag} sent: ${message}`);
    if (!r.ok) { console.log(`${tag}: chat.send error ${JSON.stringify(r.error)}`); continue; }
    let reply;
    for (let k = 0; k < 360 && reply === undefined; k++) {
      const msgs = await history().catch(() => []);
      const last = msgs.at(-1);
      if (msgs.length >= before + 2 && last?.role === "assistant" && replyText(last).trim()) reply = replyText(last).trim();
      else await sleep(500);
    }
    console.log(`${tag} reply: ${reply ?? "NO REPLY within 180 s"}`);
    await sleep(1500);
  }
} finally {
  try { client?.close(); } catch {}
  try { process.kill(-child.pid, "SIGTERM"); } catch {}
  await sleep(1500);
}
