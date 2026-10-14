// Drives a running, built Gateway over HTTP: one whole-vault wiki_search through
// POST /tools/invoke, while GET /healthz (every 250 ms) and an exact-path wiki_get
// through POST /tools/invoke (every 500 ms) are issued without waiting for each other.
// Usage: node gateway-probe.mjs --port P --token T --query Q --label L --out file.json
import fs from "node:fs/promises";
import { performance } from "node:perf_hooks";

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) { if (fallback !== undefined) return fallback; throw new Error(`missing --${name}`); }
  return process.argv[i + 1];
};
const port = arg("port");
const token = arg("token");
const query = arg("query");
const label = arg("label");
const out = arg("out");
const base = `http://127.0.0.1:${port}`;
const t0 = performance.now();
const now = () => Math.round((performance.now() - t0) * 10) / 10;

async function invoke(tool, args) {
  const res = await fetch(`${base}/tools/invoke`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ tool, args }),
  });
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body };
}

async function timed(fn) {
  const issuedAtMs = now();
  const start = performance.now();
  try {
    const r = await fn();
    return { issuedAtMs, latencyMs: Math.round((performance.now() - start) * 10) / 10, ...r };
  } catch (error) {
    return { issuedAtMs, latencyMs: Math.round((performance.now() - start) * 10) / 10, error: String(error) };
  }
}

const q = (sorted, p) => sorted.length ? sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))] : null;
const summarize = (rows) => {
  const s = rows.map((r) => r.latencyMs).toSorted((a, b) => a - b);
  return { count: s.length, p50: q(s, 0.5), p99: q(s, 0.99), max: s.at(-1) ?? null, min: s[0] ?? null };
};

// Wait for liveness.
for (let i = 0; ; i += 1) {
  try { if ((await fetch(`${base}/healthz`)).ok) break; } catch {}
  if (i > 600) throw new Error("gateway did not come up");
  await new Promise((r) => setTimeout(r, 200));
}

// Warm-up: one exact read and one whole-vault search, untimed.
const warmGet = await invoke("wiki_get", { lookup: "entities/page-1.md" });
const warmSearch = await timed(() => invoke("wiki_search", { query, maxResults: 10 }));

// Idle baselines.
const idleHealth = [];
const idleGet = [];
for (let i = 0; i < 10; i += 1) {
  idleHealth.push(await timed(async () => { const r = await fetch(`${base}/healthz`); await r.text(); return { status: r.status }; }));
  idleGet.push(await timed(async () => { const r = await invoke("wiki_get", { lookup: `entities/page-${4 * i + 1}.md` }); return { status: r.status, ok: r.body?.ok, path: r.body?.result?.details?.path ?? r.body?.result?.path }; }));
}

// Measured run.
const health = [];
const gets = [];
let done = false;
const searchStartMs = now();
const searchPromise = timed(() => invoke("wiki_search", { query, maxResults: 10 })).then((r) => { done = true; return r; });
const pending = [];
let tick = 0;
while (!done) {
  await new Promise((r) => setTimeout(r, 250));
  if (done) break;
  pending.push(timed(async () => { const r = await fetch(`${base}/healthz`); await r.text(); return { status: r.status }; }).then((r) => health.push(r)));
  if (tick % 2 === 0) {
    const n = 4 * (tick / 2) + 1;
    pending.push(timed(async () => { const r = await invoke("wiki_get", { lookup: `entities/page-${n}.md` }); return { status: r.status, ok: r.body?.ok, path: r.body?.result?.details?.path ?? r.body?.result?.path }; }).then((r) => gets.push(r)));
  }
  tick += 1;
}
const search = await searchPromise;
await Promise.all(pending);
const searchEndMs = searchStartMs + search.latencyMs;
const duringScan = (rows) => rows.filter((r) => r.issuedAtMs < searchEndMs);
const finishedBeforeScan = (rows) => rows.filter((r) => r.issuedAtMs + r.latencyMs < searchEndMs).length;

const report = {
  label,
  node: process.version,
  query,
  warmSearch: { latencyMs: warmSearch.latencyMs, status: warmSearch.status },
  warmGetStatus: warmGet.status,
  search: { latencyMs: search.latencyMs, status: search.status, ok: search.body?.ok },
  idle: { healthz: summarize(idleHealth), wikiGet: summarize(idleGet) },
  duringScan: {
    healthz: { ...summarize(duringScan(health)), finishedBeforeScanEnded: finishedBeforeScan(duringScan(health)), allStatus200: duringScan(health).every((r) => r.status === 200) },
    wikiGet: { ...summarize(duringScan(gets)), finishedBeforeScanEnded: finishedBeforeScan(duringScan(gets)), allFoundTheirPage: duringScan(gets).every((r) => r.status === 200 && r.ok === true) },
  },
  probes: { health, gets },
  searchResult: search.body,
};
await fs.writeFile(out, JSON.stringify(report, null, 2));
const { probes, searchResult, ...head } = report;
console.log(JSON.stringify(head, null, 2));
