#!/usr/bin/env node
// usage: node summarize-run.mjs <run-dir>   -> prints a text summary and writes <run-dir>/summary.json
import fs from "node:fs";
const S = process.argv[2];
const rd = (p) => { try { return fs.readFileSync(`${S}/${p}`, "utf8"); } catch { return ""; } };
const jl = (p) => rd(p).split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
const sum = {};
const snap = (() => { try { return JSON.parse(rd("snap/a-index.json")); } catch { return null; } })();
const pre = (() => { try { return JSON.parse(rd("snap/pre.json")); } catch { return null; } })();
for (const step of ["a-index", "b-status", "c-search"]) {
  const recs = jl(`obs/${step}.jsonl`);
  const s = { wallMs: Number(rd(`logs/${step}.ms`)), exit: Number(rd(`logs/${step}.exit`)), threads: {}, sql: {} };
  const last = new Map();
  for (const r of recs) if (r.event?.startsWith("totals") ) { const k = `${r.pid}:${r.threadId}`; const prev = last.get(k); if (!prev || prev.event !== "totals-final" ) last.set(k, r); }
  for (const r of recs) if (r.event === "observer-loaded") s.threads[`${r.pid}:${r.threadId}`] ??= { main: r.isMainThread, loaded: true };
  for (const [k, r] of last) {
    s.threads[k] = { main: r.isMainThread, final: r.event === "totals-final", numarr: r.numarr, typed: r.typed, num: r.num, parse: r.parse, stringifyCalls: r.stringifyAll.calls, threadCpu: r.threadCpu, processCpu: r.processCpu, rssMB: Math.round(r.rss / 1048576) };
  }
  for (const r of recs) if (r.ev === "sql") {
    const key = `${r.isMainThread ? "main" : "worker"} ${r.op} ${r.table}`;
    const a = (s.sql[key] ??= { calls: 0, rows: 0 });
    a.calls++; a.rows += Number(r.changes ?? r.rows ?? 0);
  }
  const agg = (pick) => { const o = { main: pick(null), worker: pick(null) }; return o; };
  const tot = { main: { numarrCalls: 0, numarrItems: 0, numarrOutChars: 0, numarrMs: 0, numCalls: 0, numOutChars: 0, numMs: 0, typedCalls: 0, parseCalls: 0, parseChars: 0, parseMs: 0 }, worker: null };
  tot.worker = { ...tot.main };
  for (const t of Object.values(s.threads)) {
    if (!t.numarr) continue;
    const o = t.main ? tot.main : tot.worker;
    o.numarrCalls += t.numarr.calls; o.numarrItems += t.numarr.items; o.numarrOutChars += t.numarr.outChars; o.numarrMs += t.numarr.ms;
    o.numCalls += t.num.calls; o.numOutChars += t.num.outChars; o.numMs += t.num.ms; o.typedCalls += t.typed.calls;
    o.parseCalls += t.parse.calls; o.parseChars += t.parse.inChars; o.parseMs += t.parse.ms;
  }
  s.totals = tot;
  s.cpuMainProcessMicros = Object.values(s.threads).find((t) => t.main)?.processCpu;
  s.nonFinalThreads = Object.entries(s.threads).filter(([, t]) => t.numarr && !t.final).length;
  sum[step] = s;
}
const emb = jl("embeddings.jsonl");
sum.embedRequests = { requests: emb.length, inputs: emb.reduce((n, r) => n + r.inputs, 0), chars: emb.reduce((n, r) => n + r.chars, 0) };
sum.workload = (() => { try { return JSON.parse(rd("workload.json")); } catch { return null; } })();
const chunksNew = snap?.hashes?.chunks_new?.rows ?? null;
sum.parity = snap && { counts: snap.counts, sources: snap.sources, embeddingBytes: snap.embeddingBytes, cacheBytes: snap.cacheBytes, revision: snap.revision, hashes: snap.hashes };
sum.pre = pre && { counts: { chunks: pre.counts.memory_index_chunks, cache: pre.counts.memory_embedding_cache, vecRowids: pre.counts.memory_index_chunks_vec_rowids, sources: pre.counts.memory_index_sources }, revision: pre.revision };
const I = sum["a-index"];
sum.headline = { chunksNew, chunksTotal: snap?.counts?.memory_index_chunks, chunksTimes4096: chunksNew != null ? chunksNew * 4096 : null,
  mainPrintedCoordinates: I.totals.main.numarrItems, mainPerNumberCalls: I.totals.main.numCalls, workerPrintedCoordinates: I.totals.worker.numarrItems,
  workerParseChars: I.totals.worker.parseChars, mainParseChars: I.totals.main.parseChars };
fs.writeFileSync(`${S}/summary.json`, `${JSON.stringify(sum, null, 1)}\n`);
const f = (n) => Number(n).toLocaleString("en-US");
console.log(`== summary ${S.split("/").pop()}`);
console.log(`index: exit=${I.exit} wall=${I.wallMs} ms; status exit=${sum["b-status"].exit} ${sum["b-status"].wallMs} ms; search exit=${sum["c-search"].exit} ${sum["c-search"].wallMs} ms`);
console.log(`chunks: new=${chunksNew} total=${snap?.counts?.memory_index_chunks} (pre-store chunks=${pre?.counts?.memory_index_chunks ?? "n/a"}) x4096=${chunksNew != null ? f(chunksNew * 4096) : "n/a"}`);
for (const w of ["main", "worker"]) {
  const o = I.totals[w];
  console.log(`${w}: numarr stringify calls=${f(o.numarrCalls)} items=${f(o.numarrItems)} outChars=${f(o.numarrOutChars)} ms=${o.numarrMs.toFixed(1)} | per-number calls=${f(o.numCalls)} outChars=${f(o.numOutChars)} ms=${o.numMs.toFixed(1)} | typed=${o.typedCalls} | parse calls=${f(o.parseCalls)} chars=${f(o.parseChars)} ms=${o.parseMs.toFixed(1)}`);
}
console.log(`cpu main process (us): ${JSON.stringify(I.cpuMainProcessMicros)}; threads=${Object.keys(I.threads).length} nonFinal=${I.nonFinalThreads}`);
console.log(`embedding requests: ${JSON.stringify(sum.embedRequests)}`);
console.log("observer rows (index step):"); for (const [k, v] of Object.entries(I.sql).sort()) console.log(`  ${k}: calls=${v.calls} rows=${v.rows}`);
if (snap) { console.log(`hashes: chunks=${snap.hashes.chunks_id_embedding.sha256.slice(0,16)} (${snap.hashes.chunks_id_embedding.rows}) new=${snap.hashes.chunks_new?.sha256.slice(0,16)} (${snap.hashes.chunks_new?.rows}) cache=${snap.hashes.embedding_cache.sha256.slice(0,16)} cache_nopk=${snap.hashes.embedding_cache_no_provider_key.sha256.slice(0,16)} (${snap.hashes.embedding_cache.rows}) vec_by_id=${snap.hashes.vec_by_id?.sha256?.slice(0,16)} (${snap.hashes.vec_by_id?.rows}) eq=${JSON.stringify(snap.hashes.vec_by_id?.chunkEmbeddingEqualsVec)}`);
  for (const [t, h] of Object.entries(snap.hashes.vec_shadow)) console.log(`  ${t}: ${h.sha256?.slice(0,16)} rows=${h.rows}`); }
