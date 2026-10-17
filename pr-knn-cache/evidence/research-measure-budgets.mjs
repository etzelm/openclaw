// Budget sweep for option (b): fresh read-only connection per request (today's child lifetime),
// production query at limit=24 k=192, with cache_size or mmap_size set on that connection only.
// Usage: node measure-budgets.mjs <agent-dev.sqlite> <vec0.dylib>
import { DatabaseSync } from "node:sqlite";
import { performance } from "node:perf_hooks";

const [dbPath, ext] = process.argv.slice(2);
const DIMS = 4096, SNIPPET = 700, RUNS = 5, WARM = 2, LIMIT = 24, K = 192;
let seed = 12345;
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) - 0.5;
const blob = Buffer.from(new Float32Array(DIMS).map(() => rnd()).buffer);
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const FULL = `SELECT c.id, c.path, c.start_line, c.end_line,
       CASE WHEN instr(substr(CAST(c.text AS BLOB), 1, ?), x'00') > 0
            THEN CAST(substr(CAST(c.text AS BLOB), 1, ?) AS TEXT)
            ELSE substr(c.text, 1, ?) END AS text,
       c.source, vec_distance_cosine(v.embedding, ?) AS dist
  FROM memory_index_chunks_vec v CROSS JOIN memory_index_chunks c ON c.id = v.id
 WHERE v.embedding MATCH ? AND k = ? AND c.model = ? ORDER BY dist ASC LIMIT ?`;
const sig = (rows) => JSON.stringify(rows.map((r) => [r.id, r.path, r.start_line, r.end_line, r.text, r.source, r.dist]));
let model;
function cycle(pragma) {
  const db = new DatabaseSync(dbPath, { readOnly: true, allowExtension: true });
  try {
    db.exec("PRAGMA query_only = ON; PRAGMA busy_timeout = 5000" + (pragma ? `; ${pragma}` : ""));
    db.enableLoadExtension(true);
    try { db.loadExtension(ext); db.prepare("SELECT vec_version() v").get(); } finally { db.enableLoadExtension(false); }
    model ??= db.prepare("SELECT model, count(*) n FROM memory_index_chunks GROUP BY model ORDER BY n DESC LIMIT 1").get().model;
    return db.prepare(FULL).all(SNIPPET * 4, SNIPPET * 4, SNIPPET, blob, blob, K, model, LIMIT);
  } finally { db.close(); }
}
console.log(`node ${process.version}; fresh connection per request; limit=${LIMIT} k=${K}; medians of ${RUNS} warm runs after ${WARM} warmups`);
const ref = cycle("");
for (const pragma of ["", "PRAGMA cache_size = -16384", "PRAGMA cache_size = -65536", "PRAGMA cache_size = -131072", "PRAGMA cache_size = -262144", "PRAGMA mmap_size = 67108864", "PRAGMA mmap_size = 134217728", "PRAGMA mmap_size = 1073741824"]) {
  const xs = []; let rows;
  for (let i = 0; i < WARM + RUNS; i++) { const t0 = performance.now(); rows = cycle(pragma); const t1 = performance.now(); if (i >= WARM) xs.push(t1 - t0); }
  console.log(`  ${(pragma || "defaults (cache_size=-2000, mmap_size=0)").padEnd(42)} median=${median(xs).toFixed(3)} ms runs=[${xs.map((x) => x.toFixed(1)).join(", ")}] identical=${sig(rows) === sig(ref)}`);
}
