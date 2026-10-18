#!/usr/bin/env node
// usage: node aggregate.mjs <run-root>  -> prints timing medians, serialization counters and cross-arm parity.
// Timing runs: tags r<round>-<n> (warmups excluded). Median of an even count = mean of the two middle values.
import fs from "node:fs";
const R = process.argv[2];
const rd = (p) => { try { return fs.readFileSync(p, "utf8"); } catch { return null; } };
const med = (xs) => { const s = [...xs].sort((a, b) => a - b); const n = s.length; if (!n) return NaN;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2; };
const f0 = (n) => Number.isFinite(n) ? Math.round(n).toLocaleString("en-US") : "n/a";
const f1 = (n) => Number.isFinite(n) ? n.toFixed(1) : "n/a";
const runs = fs.readdirSync(R).filter((d) => fs.existsSync(`${R}/${d}/logs`)).map((d) => {
  const [arm, W, store, ...t] = d.split("-"); const tag = t.join("-");
  const num = (p) => { const v = rd(p); return v == null || v.trim() === "" ? NaN : Number(v); };
  // An unfinished run has no .ms/.exit yet and must not count as exit 0.
  const ms = num(`${R}/${d}/logs/a-index.ms`); const exit = num(`${R}/${d}/logs/a-index.exit`);
  const ru = (() => { try { return JSON.parse(rd(`${R}/${d}/logs/a-index.rusage`)); } catch { return null; } })();
  const snap = (() => { try { return JSON.parse(rd(`${R}/${d}/snap/a-index.json`)); } catch { return null; } })();
  const sum = (() => { try { return JSON.parse(rd(`${R}/${d}/summary.json`)); } catch { return null; } })();
  // cpu-probe: the CLI process that did the work is the one with the most process CPU; its main thread is the host side.
  const probe = (rd(`${R}/${d}/logs/a-index.cpu.jsonl`) ?? "").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const worker = probe.toSorted((a, b) => b.process.user + b.process.system - a.process.user - a.process.system)[0];
  const hostCpu = worker?.thread ? (worker.thread.user + worker.thread.system) / 1e6 : NaN;
  const head = /head=([0-9a-f]+)/.exec(rd(`${R}/${d}/transcript.txt`) ?? "")?.[1];
  const load = /load averages: ([\d.]+)/.exec(rd(`${R}/${d}/transcript.txt`) ?? "")?.[1];
  return { d, arm, cell: `${W}-${store}`, tag, ms, exit, ru, snap, sum, head, load: Number(load), hostCpu };
});
const cells = [...new Set(runs.map((r) => r.cell))].sort();
const arms = ["base", ...[...new Set(runs.map((r) => r.arm))].filter((a) => a !== "base").sort()];
console.log(`# run root: ${R.split("/").pop()}; runs: ${runs.length}; failed exits: ${runs.filter((r) => r.exit !== 0).map((r) => r.d).join(",") || "none"}`);
for (const arm of arms) console.log(`# ${arm} heads: ${[...new Set(runs.filter((r) => r.arm === arm).map((r) => r.head))].join(",")}`);
console.log("\n## Timing (observer off): index step wall ms and CPU user+sys s (CLI process tree), median per round and pooled");
for (const cell of cells) for (const arm of arms) {
  const t = runs.filter((r) => r.cell === cell && r.arm === arm && /^r\d+-\d+$/.test(r.tag) && r.exit === 0);
  if (!t.length) continue;
  const by = (round) => t.filter((r) => r.tag.startsWith(`r${round}-`));
  const cpu = (r) => r.ru ? r.ru.user + r.ru.sys : NaN;
  const line = (sel) => `wall ${f0(med(sel.map((r) => r.ms)))} ms, cpu ${f1(med(sel.map(cpu)))} s, n=${sel.length}`;
  console.log(`${cell} ${arm}: pooled ${line(t)} | r1 ${line(by(1))} | r2 ${line(by(2))} | load1 ${f1(Math.min(...t.map((r) => r.load)))}..${f1(Math.max(...t.map((r) => r.load)))}`);
  console.log(`  wall ms: ${t.map((r) => `${r.tag}=${f0(r.ms)}`).join(" ")}`);
  console.log(`  cpu s:   ${t.map((r) => `${r.tag}=${f1(cpu(r))}`).join(" ")}`);
  const hc = t.filter((r) => Number.isFinite(r.hostCpu));
  if (hc.length) console.log(`  host main-thread cpu s (cpu probe, n=${hc.length}): median ${f1(med(hc.map((r) => r.hostCpu)))} | ${hc.map((r) => `${r.tag}=${f1(r.hostCpu)}`).join(" ")}`);
  console.log(`  maxRSS MB median: ${f0(med(t.filter((r) => r.ru).map((r) => r.ru.maxRssBytes / 1048576)))}`);
}
console.log("\n## Single observer-off runs (tag t<n>)");
for (const r of runs.filter((x) => /^t\d+$/.test(x.tag)).sort((a, b) => a.d.localeCompare(b.d)))
  console.log(`${r.cell} ${r.arm} ${r.tag}: wall ${f0(r.ms)} ms, cpu ${r.ru ? f1(r.ru.user + r.ru.sys) : "n/a"} s, host main-thread cpu ${f1(r.hostCpu)} s, maxRSS ${r.ru ? f0(r.ru.maxRssBytes / 1048576) : "n/a"} MB, load1 ${f1(r.load)}, exit ${r.exit}`);
console.log("\n## Serialization counters (observed runs, index step)");
for (const cell of cells) for (const arm of arms) {
  const r = runs.find((x) => x.cell === cell && x.arm === arm && x.tag === "obs"); if (!r?.sum) continue;
  const m = r.sum["a-index"].totals.main, w = r.sum["a-index"].totals.worker; const n = r.sum.headline.chunksNew;
  console.log(`${cell} ${arm}: chunks=${f0(n)} | host vector-array stringify calls=${f0(m.numarrCalls)} (${f1(m.numarrCalls / n)}/chunk) coords=${f0(m.numarrItems)} chars=${f0(m.numarrOutChars)} ms=${f1(m.numarrMs)} | host per-number stringify calls=${f0(m.numCalls)} ms=${f1(m.numMs)} | host parse chars=${f0(m.parseChars)} ms=${f1(m.parseMs)} | worker parse calls=${f0(w.parseCalls)} chars=${f0(w.parseChars)} ms=${f1(w.parseMs)} | wall=${f0(r.ms)} ms (observer on) | cpu=${r.ru ? f1(r.ru.user + r.ru.sys) : "n/a"} s`);
}
console.log("\n## Parity (stored bytes) across all runs of a cell");
const keys = (s) => ({ chunks_id_embedding: s.hashes.chunks_id_embedding.sha256, embedding_cache: s.hashes.embedding_cache.sha256,
  vec_by_id: s.hashes.vec_by_id?.sha256, vec_chunks: s.hashes.vec_shadow.memory_index_chunks_vec_chunks?.sha256, vec_info: s.hashes.vec_shadow.memory_index_chunks_vec_info?.sha256,
  chunks: s.counts.memory_index_chunks, cache: s.counts.memory_embedding_cache });
let mism = 0;
for (const cell of cells) {
  const rs = runs.filter((r) => r.cell === cell && r.snap && r.exit === 0);
  if (!rs.length) continue;
  const ref = keys(rs[0].snap);
  for (const r of rs) { const k = keys(r.snap); for (const [n, v] of Object.entries(ref)) if (k[n] !== v) { mism++; console.log(`MISMATCH ${cell} ${r.d} ${n}`); } }
  console.log(`${cell}: ${rs.length} runs (${arms.map((a) => `${rs.filter((r) => r.arm === a).length} ${a}`).join(", ")}); chunks=${ref.chunks} cache=${ref.cache}; chunks_id_embedding=${ref.chunks_id_embedding.slice(0, 16)} embedding_cache=${ref.embedding_cache.slice(0, 16)} vec_by_id=${ref.vec_by_id?.slice(0, 16)} vec_chunks=${ref.vec_chunks?.slice(0, 16)} vec_info=${ref.vec_info?.slice(0, 16)}`);
}
console.log(`# parity mismatches: ${mism}`);
