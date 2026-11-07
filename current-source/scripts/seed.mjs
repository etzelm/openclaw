// L3d synthetic seed through a running Gateway (supported RPCs only).
// usage: node seed.mjs <wsModulePath> <port> <plan.json> <outOpsJson>
//   plan.json from mkplan.py: { inject: [{agent, key, messages: [len...]}], claude: n }
// Creates each inject session with sessions.create and appends assistant messages with chat.inject
// (8 sessions in parallel, messages within a session in order), then imports every Claude CLI catalog
// thread with sessions.catalog.import. Writes the chat.history ops file for every created session.
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
const [wsPath, port, planFile, outOps] = process.argv.slice(2);
const WebSocket = createRequire(wsPath)("ws");
const plan = JSON.parse(readFileSync(planFile, "utf8"));

function connect() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    const pending = new Map();
    const req = (method, params, timeoutMs = 300000) => new Promise((res, rej) => {
      const id = randomUUID();
      const t = setTimeout(() => { pending.delete(id); rej(new Error("timeout " + method)); }, timeoutMs);
      pending.set(id, { res, rej, t });
      ws.send(JSON.stringify({ type: "req", id, method, params }));
    });
    ws.on("message", (d) => {
      const f = JSON.parse(d.toString());
      if (f.type === "res" && pending.has(f.id)) { const p = pending.get(f.id); pending.delete(f.id); clearTimeout(p.t); p.res(f); }
    });
    ws.on("error", reject);
    ws.on("open", async () => {
      const hello = await req("connect", { minProtocol: 4, maxProtocol: 4,
        client: { id: "gateway-client", displayName: "l3d-seed", version: "1.0.0", platform: process.platform, mode: "backend" },
        role: "operator", scopes: ["operator.read", "operator.write", "operator.admin"], caps: [] }, 60000);
      if (!hello.ok) return reject(new Error("connect: " + JSON.stringify(hello.error)));
      // Startup sidecars answer retryable UNAVAILABLE until ready.
      const retrying = async (method, params) => {
        for (let i = 0; ; i++) {
          const r = await req(method, params);
          if (r.ok || !r.error?.retryable || i > 600) return r;
          await new Promise((res) => setTimeout(res, r.error.retryAfterMs ?? 500));
        }
      };
      resolve({ ws, req: retrying });
    });
  });
}
// Deterministic filler text: words from a fixed vocabulary, seeded per message.
const vocab = "the gateway reads a page of session history from postgres while workers wait on bridge replies and the queue grows under load so we measure tail latency per request with a closed loop driver across sessions agents and transcripts of varied size including code blocks lists and tool output".split(" ");
function text(seed, len) {
  let s = seed >>> 0, out = "";
  while (out.length < len) { s = (s * 1103515245 + 12345) >>> 0; out += vocab[s % vocab.length] + ((s >> 8) % 13 === 0 ? ".\n" : " "); }
  return out.slice(0, len);
}
const fail = (what, r) => { throw new Error(`${what}: ${JSON.stringify(r.error ?? r).slice(0, 400)}`); };
const t0 = Date.now();
const clients = await Promise.all(Array.from({ length: 8 }, connect));
const keys = [];
let next = 0, done = 0, msgs = 0;
await Promise.all(clients.map(async (c) => {
  while (next < plan.inject.length) {
    const s = plan.inject[next++];
    const r = await c.req("sessions.create", { key: s.key, agentId: s.agent });
    if (!r.ok) fail(`create ${s.key}`, r);
    const key = r.payload?.key ?? r.payload?.sessionKey ?? s.key;
    for (let i = 0; i < s.messages.length; i++) {
      const ri = await c.req("chat.inject", { sessionKey: key, message: text(s.seed + i, s.messages[i]) });
      if (!ri.ok) fail(`inject ${key}#${i}`, ri);
      msgs++;
    }
    keys.push(key);
    if (++done % 20 === 0) console.log(`inject ${done}/${plan.inject.length} sessions, ${msgs} messages, ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  }
}));
const c0 = clients[0];
// Claude CLI threads written into $HOME/.claude/projects before boot.
const found = [];
const walk = (o, ctx) => {
  if (Array.isArray(o)) return o.forEach((x) => walk(x, ctx));
  if (!o || typeof o !== "object") return;
  const here = { ...ctx, ...(o.catalogId ? { catalogId: o.catalogId } : Array.isArray(o.hosts) && o.id ? { catalogId: o.id } : {}), ...(o.hostId ? { hostId: o.hostId } : {}) };
  if (o.threadId && here.catalogId && here.hostId) found.push({ catalogId: here.catalogId, hostId: here.hostId, threadId: o.threadId });
  Object.values(o).forEach((v) => walk(v, here));
};
if (plan.claude > 0) {
  for (let attempt = 0; attempt < 30 && found.length < plan.claude; attempt++) {
    found.length = 0;
    const r = await c0.req("sessions.catalog.list", { catalogId: "claude", agentId: "main", limitPerHost: 100 });
    // Plugin catalogs register after the Gateway starts answering.
    if (!r.ok && attempt < 29) { await new Promise((res) => setTimeout(res, 2000)); continue; }
    if (!r.ok) fail("catalog.list", r);
    writeFileSync(planFile.replace(/\.json$/, "") + ".catalog.json", JSON.stringify(r.payload).slice(0, 200000));
    walk(r.payload, {});
    if (found.length < plan.claude) await new Promise((res) => setTimeout(res, 2000));
  }
  console.log(`claude catalog threads: ${found.length}`);
  for (const loc of found) {
    const r = await c0.req("sessions.catalog.import", { ...loc, agentId: "main" });
    if (!r.ok) fail(`import ${loc.threadId}`, r);
    keys.push(r.payload.sessionKey);
    if (!r.payload.complete) console.log("partial import", JSON.stringify(r.payload));
  }
}
writeFileSync(outOps, JSON.stringify([{ name: "chat.history", method: "chat.history", weight: 1,
  params: keys.map((sessionKey) => ({ sessionKey, limit: 100 })) }]));
console.log(`SEED_DONE sessions=${keys.length} injected=${msgs} claude=${found.length} ${((Date.now() - t0) / 1000).toFixed(0)} s`);
process.exit(0);
