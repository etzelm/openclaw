#!/usr/bin/env node
// Summarizes the t2-02 proof runs. usage: node summarize.mjs <runs-dir>
// Reads only files written by run-arm.sh (snapshots, observer JSONL, stub request log, CLI output).
import fs from "node:fs";
import path from "node:path";

const dir = process.argv[2];
const read = (p) => (fs.existsSync(p) ? fs.readFileSync(p, "utf8") : "");
const jsonl = (p) => read(p).trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
function obsTotals(file) {
  const t = {};
  for (const r of jsonl(file)) {
    if (r.event) continue;
    const k = `${r.op} ${r.table}`;
    t[k] ??= { statements: 0, rows: 0 };
    t[k].statements += 1;
    t[k].rows += r.changes ?? r.rows ?? 0;
  }
  return t;
}
const rows = (t, k) => t[k]?.rows ?? 0;
function emb(run, step) {
  const [e0, e1] = read(path.join(run, "logs", `${step}.embseq`)).trim().split(" ").map(Number);
  const reqs = jsonl(path.join(run, "embeddings.jsonl")).filter((r) => r.seq > e0 && r.seq <= e1);
  return { requests: reqs.length, inputs: reqs.reduce((n, r) => n + r.inputs, 0) };
}
function search(run, step) {
  const out = read(path.join(run, "logs", `${step}.out`));
  try {
    const res = JSON.parse(out).results ?? [];
    return { hits: res.length, top: res[0] ? `${res[0].path}:${res[0].startLine}-${res[0].endLine}` : "-" };
  } catch { return { hits: "parse-error", top: "-" }; }
}
const lines = [];
const header = ["run", "chunks a/b", "kept ids", "kept rows byte-identical (rowid, lines, hash, updated_at, emb)", "kept rows with new updated_at", "new ids", "removed ids",
  "revision a -> b (delta)", "b-index chunk rows del/ins", "b-index vec rows del/ins", "b-index recall/prov upserts", "embed req/inputs a-index", "embed req/inputs b-index",
  "search copperwillow hits, top", "search tundrabeacon hits, top", "exits a,b,c1,c2,d"];
lines.push(header.join(" | "));
const result = {};
for (const name of fs.readdirSync(dir).sort()) {
  const run = path.join(dir, name);
  const a = JSON.parse(read(path.join(run, "snap", "a-index.json")));
  const b = JSON.parse(read(path.join(run, "snap", "b-index.json")));
  const A = new Map(a.chunks.map((c) => [c.id, c]));
  const B = new Map(b.chunks.map((c) => [c.id, c]));
  let identical = 0, bumped = 0;
  const keys = ["chunk_rowid", "start_line", "end_line", "hash", "updated_at", "embedding_bytes"];
  for (const [id, c] of B) {
    const p = A.get(id);
    if (!p) continue;
    if (keys.every((k) => p[k] === c[k])) identical += 1;
    if (p.updated_at !== c.updated_at) bumped += 1;
  }
  const kept = [...B.keys()].filter((id) => A.has(id)).length;
  const added = [...B.keys()].filter((id) => !A.has(id)).length;
  const removed = [...A.keys()].filter((id) => !B.has(id)).length;
  const ob = obsTotals(path.join(run, "obs", "b-index.jsonl"));
  const ea = emb(run, "a-index"), eb = emb(run, "b-index");
  const s1 = search(run, "c1-search"), s2 = search(run, "c2-search");
  const exits = ["a-index", "b-index", "c1-search", "c2-search", "d-status"].map((s) => read(path.join(run, "logs", `${s}.exit`)).trim()).join(",");
  const r = {
    chunksA: a.chunks.length, chunksB: b.chunks.length, kept, identical, bumped, added, removed,
    revA: a.revision, revB: b.revision, revDelta: b.revision - a.revision,
    chunkDel: rows(ob, "delete memory_index_chunks"), chunkIns: rows(ob, "insert memory_index_chunks"),
    vecDel: rows(ob, "delete memory_index_chunks_vec"), vecIns: rows(ob, "insert memory_index_chunks_vec"),
    recall: rows(ob, "insert memory_index_chunk_recall_metadata"), prov: rows(ob, "insert memory_index_chunk_provenance"),
    embA: ea, embB: eb, s1, s2, exits,
    distinctUpdatedAtB: new Set(b.chunks.map((c) => c.updated_at)).size,
    cacheRowsB: b.counts.memory_embedding_cache ?? 0,
    observerB: ob,
  };
  result[name] = r;
  lines.push([name, `${r.chunksA}/${r.chunksB}`, kept, identical, bumped, added, removed, `${r.revA} -> ${r.revB} (+${r.revDelta})`,
    `${r.chunkDel}/${r.chunkIns}`, `${r.vecDel}/${r.vecIns}`, `${r.recall}/${r.prov}`, `${ea.requests}/${ea.inputs}`, `${eb.requests}/${eb.inputs}`,
    `${s1.hits}, ${s1.top}`, `${s2.hits}, ${s2.top}`, exits].join(" | "));
}
console.log(lines.join("\n"));
console.log("\n# per-run detail (b-index observer totals: statements and rows per operation and table)");
for (const [k, v] of Object.entries(result)) {
  console.log(`\n## ${k}: distinct updated_at among all rows after b-index = ${v.distinctUpdatedAtB}; embedding cache rows after b-index = ${v.cacheRowsB}`);
  for (const [op, t] of Object.entries(v.observerB)) console.log(`  ${op}: ${t.statements} statements, ${t.rows} rows`);
}

// Cross-arm parity: stored rows after the append (excluding chunk_rowid and updated_at) and
// search output (excluding provenance.observedAt, which is the file mtime of each run).
import crypto from "node:crypto";
const sha = (v) => crypto.createHash("sha256").update(JSON.stringify(v)).digest("hex").slice(0, 16);
const stripObserved = (text) => {
  try {
    const j = JSON.parse(text);
    for (const r of j.results ?? []) if (r.provenance) delete r.provenance.observedAt;
    return j;
  } catch { return text; }
};
console.log("\n# cross-arm parity (BEFORE vs AFTER, same configuration)");
for (const name of Object.keys(result).filter((n) => n.startsWith("base-"))) {
  const other = name.replace(/^base-/, "head-");
  if (!result[other]) continue;
  const rowsOf = (n) => JSON.parse(read(path.join(dir, n, "snap", "b-index.json"))).chunks
    .map(({ id, path: p, start_line, end_line, hash, model, embedding_bytes }) => ({ id, p, start_line, end_line, hash, model, embedding_bytes }))
    .sort((x, y) => (x.id < y.id ? -1 : 1));
  const rb = sha(rowsOf(name)), rh = sha(rowsOf(other));
  const sr = (n, s) => sha(stripObserved(read(path.join(dir, n, "logs", `${s}.out`))));
  const s1 = [sr(name, "c1-search"), sr(other, "c1-search")], s2 = [sr(name, "c2-search"), sr(other, "c2-search")];
  console.log(`${name.replace(/^base-/, "")}: rows ${rb} vs ${rh} ${rb === rh ? "equal" : "DIFFERENT"}; search copperwillow ${s1[0]} vs ${s1[1]} ${s1[0] === s1[1] ? "equal" : "DIFFERENT"}; search tundrabeacon ${s2[0]} vs ${s2[1]} ${s2[0] === s2[1] ? "equal" : "DIFFERENT"}`);
}
console.log("\n# threads and built modules that wrote chunk and vector rows during b-index");
for (const name of Object.keys(result)) {
  const recs = jsonl(path.join(dir, name, "obs", "b-index.jsonl")).filter((r) => r.frames);
  const threads = [...new Set(recs.map((r) => `thread ${r.threadId} (isMainThread ${r.isMainThread})`))];
  const stacks = [...new Set(recs.map((r) => `${r.op} ${r.table}: ${r.frames.join(" < ")}`))];
  console.log(`\n## ${name}: ${recs.length} records; ${threads.join(", ")}`);
  for (const s of stacks) console.log(`  ${s}`);
}
