// pg-sqlite-bench load driver: one WS client per worker, read-only gateway RPCs, per-op latency.
// usage: node driver.mjs <wsModulePath> <port> <mode:discover|load> [durationS] [concurrency] [outJson] [opsJson]
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { readFileSync, writeFileSync } from "node:fs";
const [wsPath, port, mode, durS = "60", conc = "8", out = "", opsFile = ""] = process.argv.slice(2);
const WebSocket = createRequire(wsPath)("ws");

function connect() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    const pending = new Map();
    const req = (method, params, timeoutMs = 120000) => new Promise((res, rej) => {
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
      try {
        const hello = await req("connect", { minProtocol: 4, maxProtocol: 4,
          client: { id: "gateway-client", displayName: "pg-sqlite-bench", version: "1.0.0", platform: process.platform, mode: "backend" },
          role: "operator", scopes: ["operator.read"], caps: ["hello-health-on-demand"] }, 60000);
        if (!hello.ok) return reject(new Error("connect: " + JSON.stringify(hello.error)));
        resolve({ ws, req, hello: hello.payload });
      } catch (e) { reject(e); }
    });
  });
}
const pct = (a, p) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return +s[Math.min(s.length - 1, Math.ceil(p / 100 * s.length) - 1)].toFixed(2); };
const stats = (a) => ({ n: a.length, p50: pct(a, 50), p95: pct(a, 95), p99: pct(a, 99), max: a.length ? +Math.max(...a).toFixed(2) : null, mean: a.length ? +(a.reduce((x, y) => x + y, 0) / a.length).toFixed(2) : null });

const c0 = await connect();
if (mode === "discover") {
  console.log(JSON.stringify({ server: c0.hello.server, methods: c0.hello.features.methods }, null, 0));
  process.exit(0);
}
if (mode === "call") { // durS = method, conc = params json
  const r = await c0.req(durS, JSON.parse(conc)); console.log(JSON.stringify(r).slice(0, Number(out || 4000))); process.exit(0);
}
// load: ops = [{name, method, params, weight}]
const ops = JSON.parse(readFileSync(opsFile, "utf8"));
const total = ops.reduce((s, o) => s + o.weight, 0);
const pick = () => { let r = Math.random() * total; for (const o of ops) { if ((r -= o.weight) < 0) return o; } return ops[ops.length - 1]; };
const lat = {}; const errs = {}; ops.forEach(o => { lat[o.name] = []; errs[o.name] = 0; });
const clients = [c0]; for (let i = 1; i < Number(conc); i++) clients.push(await connect());
const end = performance.now() + Number(durS) * 1000;
const t0 = performance.now();
const rec = [];
await Promise.all(clients.map(async (c) => {
  while (performance.now() < end) {
    const o = pick(); const pi = Array.isArray(o.params) ? Math.floor(Math.random() * o.params.length) : -1; const p = pi < 0 ? o.params : o.params[pi];
    const s = performance.now();
    try { const r = await c.req(o.method, p); const ms = performance.now() - s; if (r.ok) { lat[o.name].push(ms); rec.push([o.name, pi, +(s - t0).toFixed(1), +ms.toFixed(2), r.payload === undefined ? 0 : JSON.stringify(r.payload).length]); } else { errs[o.name]++; if (errs[o.name] < 3) console.error(o.name, JSON.stringify(r.error).slice(0, 300)); } }
    catch (e) { errs[o.name]++; if (errs[o.name] < 3) console.error(o.name, String(e)); }
  }
}));
const wall = (performance.now() - t0) / 1000;
const all = Object.values(lat).flat();
const res = { wallS: +wall.toFixed(2), concurrency: Number(conc), totalOk: all.length, rps: +(all.length / wall).toFixed(1), overall: stats(all), perOp: Object.fromEntries(ops.map(o => [o.name, { ...stats(lat[o.name]), errors: errs[o.name] }])) };
if (out) writeFileSync(out, JSON.stringify(res, null, 1));
if (out) writeFileSync(out.replace(/\.json$/, '') + '.calls.tsv', 'op\tparam\tstartMs\tms\tbytes\n' + rec.map((r) => r.join('\t')).join('\n') + '\n');
console.log(JSON.stringify(res));
process.exit(0);
