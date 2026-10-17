// usage: node summarize.mjs  -> writes ../summary-data.json and prints markdown tables
import fs from "node:fs";
const P = "<scratch>";
const rd = (f) => fs.readFileSync(f, "utf8");
const jl = (f) => rd(f).trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
const med = (a) => { const s = [...a].sort((x, y) => x - y); const n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : NaN; };
const runs = {};
for (const arm of ["before", "after"]) for (const label of fs.readdirSync(`${P}/gateway/${arm}`)) {
  const D = `${P}/gateway/${arm}/${label}`;
  const calls = jl(`${D}/calls.jsonl`); const obs = jl(`${D}/gateway.obs.jsonl`);
  const rows = calls.map((c) => {
    const o = obs.filter((r) => r.t >= c.start && r.t <= c.end);
    const search = o.filter((r) => r.shape && r.shape !== "reconcile_count");
    const runsEv = search.filter((r) => r.ev === "run");
    const eps = search.filter((r) => r.ev === "episode");
    return { step: c.step, method: c.method, status: c.status, wallMs: c.end - c.start,
      fn: o.filter((r) => r.ev === "fn").length, prepares: search.filter((r) => r.ev === "prepare").length,
      runs: runsEv.length, runUs: Number(runsEv.reduce((a, r) => a + r.us, 0).toFixed(1)),
      episodes: eps.length, compiles: eps.filter((r) => r.readChunks > 0).length, cb: eps.reduce((a, r) => a + r.cb, 0),
      epPrepare: eps.filter((r) => r.where === "prepare").length, epRun: eps.filter((r) => r.where === "run").length,
      reconcilePrep: o.filter((r) => r.ev === "prepare" && r.shape === "reconcile_count").length,
      outside: 0 };
  });
  const inWin = (r) => calls.some((c) => r.t >= c.start && r.t <= c.end);
  const outside = obs.filter((r) => !inWin(r));
  runs[`${arm}/${label}`] = { rows, outsideCounts: outside.reduce((m, r) => (m[r.ev] = (m[r.ev] ?? 0) + 1, m), {}), authInstalls: obs.filter(r=>r.ev==="auth_install").length, fnTotal: obs.filter((r) => r.ev === "fn").length, threads: [...new Set(obs.map((r) => r.thr))], pids: [...new Set(obs.map((r) => r.pid))] };
}
fs.writeFileSync(`${P}/summary-data.json`, JSON.stringify(runs, null, 1));
let md = "";
for (const [k, v] of Object.entries(runs)) {
  if (!k.endsWith("/c1")) continue;
  md += `\n### ${k} (counting observer)\n\npids ${v.pids}, threads ${v.threads}, authorizer installs ${v.authInstalls}, total fn registrations in whole run ${v.fnTotal}, events outside any call window: ${JSON.stringify(v.outsideCounts)}\n\n| step | method | exit | wall ms | fn regs | search prepares | search runs | run us (sum) | compile episodes (all) | compiles (READ memory_index_chunks) | auth callbacks | episodes in prepare | episodes in run |\n|---|---|---|---|---|---|---|---|---|---|---|---|---|\n`;
  for (const r of v.rows) md += `| ${r.step} | ${r.method} | ${r.status} | ${r.wallMs} | ${r.fn} | ${r.prepares} | ${r.runs} | ${r.runUs} | ${r.episodes} | ${r.compiles} | ${r.cb} | ${r.epPrepare} | ${r.epRun} |\n`;
  const s = v.rows.filter((r) => r.method === "memory.search");
  const sum = (f, a) => a.reduce((x, r) => x + r[f], 0);
  md += `\nTotals over 30 searches: fn regs ${sum("fn", s)}, prepares ${sum("prepares", s)}, runs ${sum("runs", s)}, compiles ${sum("compiles", s)}, episodes ${sum("episodes", s)}, callbacks ${sum("cb", s)}, run us ${sum("runUs", s).toFixed(0)}. Requests 11-30: fn ${sum("fn", s.slice(10))}, prepares ${sum("prepares", s.slice(10))}, compiles ${sum("compiles", s.slice(10))}, episodes ${sum("episodes", s.slice(10))}, callbacks ${sum("cb", s.slice(10))}.\n`;
}
md += "\n### timing-only runs (no authorizer, no EQP): summed search-statement run microseconds per request\n\n| run | median req 11-30 (us) | median req 1-10 (us) | mean 11-30 (us) | fn regs total | prepares 11-30 | raw (30 values, us) |\n|---|---|---|---|---|---|---|\n";
for (const [k, v] of Object.entries(runs)) {
  if (!/\/t\d$/.test(k)) continue;
  const s = v.rows.filter((r) => r.method === "memory.search");
  const u = s.map((r) => r.runUs);
  md += `| ${k} | ${med(u.slice(10)).toFixed(1)} | ${med(u.slice(0, 10)).toFixed(1)} | ${(u.slice(10).reduce((a, b) => a + b, 0) / 20).toFixed(1)} | ${v.fnTotal} | ${s.slice(10).reduce((a, r) => a + r.prepares, 0)} | ${u.join(" ")} |\n`;
}
fs.writeFileSync(`${P}/summary-tables.md`, md);
console.log(md);
