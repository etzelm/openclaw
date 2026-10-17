// Where the file-backed memory vector query spends its time, and what each option changes.
// Usage: node measure-rerank.mjs <agent-dev.sqlite> <vec0.dylib>
// Read-only. Prints timings, counts, and comparisons only (no ids, text, or vectors).
// Query vector is synthetic (seeded PRNG). Medians of five warm runs after two warmups.
import { DatabaseSync } from "node:sqlite";
import { performance } from "node:perf_hooks";

const [dbPath, ext] = process.argv.slice(2);
const DIMS = 4096, SNIPPET = 700, RUNS = 5, WARM = 2;
let seed = 12345;
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) - 0.5;
const qf32 = new Float32Array(DIMS).map(() => rnd());
const blob = Buffer.from(qf32.buffer);
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
function time(label, fn) {
  const xs = []; let out;
  for (let i = 0; i < WARM + RUNS; i++) {
    const t0 = performance.now(); out = fn(); const t1 = performance.now();
    if (i >= WARM) xs.push(t1 - t0);
  }
  console.log(`  ${label.padEnd(66)} median=${median(xs).toFixed(3)} ms runs=[${xs.map((x) => x.toFixed(1)).join(", ")}]`);
  return out;
}
function open(pragmas = "") {
  const db = new DatabaseSync(dbPath, { readOnly: true, allowExtension: true });
  db.exec("PRAGMA query_only = ON; PRAGMA busy_timeout = 5000" + pragmas);
  db.enableLoadExtension(true);
  try { db.loadExtension(ext); db.prepare("SELECT vec_version() AS v").get(); } finally { db.enableLoadExtension(false); }
  return db;
}
// Production query shape: extensions/memory-core/src/memory/manager-search-knn.ts:71-81 (one model, no source filter).
const SNIP = `CASE WHEN instr(substr(CAST(c.text AS BLOB), 1, ?), x'00') > 0
            THEN CAST(substr(CAST(c.text AS BLOB), 1, ?) AS TEXT)
            ELSE substr(c.text, 1, ?) END AS text`;
const FULL = `SELECT c.id, c.path, c.start_line, c.end_line, ${SNIP}, c.source,
       vec_distance_cosine(v.embedding, ?) AS dist
  FROM memory_index_chunks_vec v CROSS JOIN memory_index_chunks c ON c.id = v.id
 WHERE v.embedding MATCH ? AND k = ? AND c.model = ? ORDER BY dist ASC LIMIT ?`;
const L2DIST = `SELECT c.id, c.path, c.start_line, c.end_line, ${SNIP}, c.source,
       v.distance AS l2
  FROM memory_index_chunks_vec v CROSS JOIN memory_index_chunks c ON c.id = v.id
 WHERE v.embedding MATCH ? AND k = ? AND c.model = ? ORDER BY l2 ASC LIMIT ?`;
const KNN_ONLY = "SELECT id, distance FROM memory_index_chunks_vec WHERE embedding MATCH ? AND k = ?";
const KNN_EMB = "SELECT id, embedding FROM memory_index_chunks_vec WHERE embedding MATCH ? AND k = ?";
const sig = (rows) => JSON.stringify(rows.map((r) => [r.id, r.path, r.start_line, r.end_line, r.text, r.source, r.dist]));

const base = open();
console.log(`node ${process.version} sqlite ${base.prepare("select sqlite_version() v").get().v} vec ${base.prepare("select vec_version() v").get().v}`);
console.log(`defaults on this connection: cache_size=${base.prepare("pragma cache_size").get().cache_size} mmap_size=${base.prepare("pragma mmap_size").get().mmap_size} page_size=${base.prepare("pragma page_size").get().page_size}`);
const vb = base.prepare("SELECT count(*) n, sum(length(vectors)) b, min(length(vectors)) mn FROM memory_index_chunks_vec_vector_chunks00").get();
console.log(`vec0 vector chunk blobs: ${vb.n} blobs, ${vb.b} bytes total, ${vb.mn} bytes each (min)`);
const ce = base.prepare("SELECT count(*) n, min(length(embedding)) mn, max(length(embedding)) mx FROM memory_index_chunks").get();
console.log(`memory_index_chunks.embedding: ${ce.n} rows, ${ce.mn}..${ce.mx} bytes`);
const model = base.prepare("SELECT model, count(*) n FROM memory_index_chunks GROUP BY model ORDER BY n DESC LIMIT 1").get().model;

for (const [LIMIT, label] of [[24, "production default: maxResults 6 x candidateMultiplier 4"], [10, "limit 10"]]) {
  const K = Math.min(LIMIT * 8, 4096);
  const params = [SNIPPET * 4, SNIPPET * 4, SNIPPET, blob, blob, K, model, LIMIT];
  console.log(`\n== limit=${LIMIT} k=${K} (${label})`);
  const ref = time("A full production query, reused connection, defaults", () => base.prepare(FULL).all(...params));
  time("B vec0 KNN only (id, distance), no join", () => base.prepare(KNN_ONLY).all(blob, K));
  time("C vec0 KNN selecting embedding (KNN + candidate embedding fetch)", () => base.prepare(KNN_EMB).all(blob, K));
  const candIds = base.prepare(KNN_ONLY).all(blob, K).map((r) => r.id);
  const byId = base.prepare("SELECT embedding FROM memory_index_chunks_vec WHERE id = ?");
  time(`C2 embedding point lookups for the ${K} candidate ids (no KNN)`, () => { for (const id of candIds) byId.get(id); });
  const l2rows = time("D same join ordering by vec0 v.distance (no v.embedding read)", () => base.prepare(L2DIST).all(...params.slice(0, 3), blob, K, model, LIMIT));

  const fresh = (pragmas) => () => { const db = open(pragmas); try { return db.prepare(FULL).all(...params); } finally { db.close(); } };
  const e = time("E fresh connection per request (today's child cycle), defaults", fresh(""));
  const f = time("F fresh connection per request + PRAGMA mmap_size=1073741824", fresh("; PRAGMA mmap_size = 1073741824"));
  const fc = time("F2 fresh connection per request + PRAGMA cache_size=-262144", fresh("; PRAGMA cache_size = -262144"));
  const g = open("; PRAGMA cache_size = -262144");
  const gr = time("G reused connection + PRAGMA cache_size=-262144 (256 MiB)", () => g.prepare(FULL).all(...params));
  g.close();
  const hm = open("; PRAGMA mmap_size = 1073741824");
  const hr = time("H reused connection + PRAGMA mmap_size=1073741824", () => hm.prepare(FULL).all(...params));
  hm.close();
  for (const [n, rows] of [["E", e], ["F", f], ["F2", fc], ["G", gr], ["H", hr]]) {
    console.log(`  identical rows and distances A vs ${n}: ${sig(ref) === sig(rows)} (rows=${rows.length})`);
  }
  // Option: rerank from vec0 L2 distance. Cosine distance equals l2^2/2 only for unit vectors.
  const sameOrder = JSON.stringify(ref.map((r) => r.id)) === JSON.stringify(l2rows.map((r) => r.id));
  const setEq = new Set(ref.map((r) => r.id)); const overlap = l2rows.filter((r) => setEq.has(r.id)).length;
  const maxDiff = Math.max(...ref.map((r) => { const m = l2rows.find((x) => x.id === r.id); return m ? Math.abs(r.dist - (m.l2 * m.l2) / 2) : NaN; }).filter(Number.isFinite));
  console.log(`  D vs A: same id order=${sameOrder}, overlap=${overlap}/${ref.length}, max |cosine_dist - l2^2/2| over shared ids=${maxDiff.toExponential(3)}`);
}

// Norms of stored vec0 vectors (decides whether L2 ordering equals cosine ordering).
{
  const it = base.prepare("SELECT embedding FROM memory_index_chunks_vec").iterate();
  let mn = Infinity, mx = -Infinity, n = 0;
  for (const r of it) {
    const v = new Float32Array(r.embedding.buffer, r.embedding.byteOffset, DIMS);
    let s = 0; for (let j = 0; j < DIMS; j++) s += v[j] * v[j];
    const norm = Math.sqrt(s); if (norm < mn) mn = norm; if (norm > mx) mx = norm; n++;
  }
  console.log(`\nvec0 stored vector L2 norms over ${n} rows: min=${mn.toFixed(6)} max=${mx.toFixed(6)}`);
}

// Offset dependence of a single embedding fetch: position inside the 16 MiB chunk blob.
{
  const pick = (where) => base.prepare(`SELECT id FROM memory_index_chunks_vec_rowids WHERE ${where} ORDER BY rowid LIMIT 64`).all().map((r) => r.id);
  const lo = pick("chunk_offset < 64"), hi = pick("chunk_offset >= 960");
  const byId = base.prepare("SELECT embedding FROM memory_index_chunks_vec WHERE id = ?");
  console.log(`\nembedding point lookup, 64 ids per set, default cache:`);
  time("chunk_offset < 64 (start of chunk blob)", () => { for (const id of lo) byId.get(id); });
  time("chunk_offset >= 960 (end of chunk blob)", () => { for (const id of hi) byId.get(id); });
}
base.close();
const ru = process.resourceUsage();
console.log(`\nprocess resourceUsage: user=${(ru.userCPUTime / 1000).toFixed(0)} ms system=${(ru.systemCPUTime / 1000).toFixed(0)} ms`);
