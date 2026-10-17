// Measures the per-request reopen cycle of sqlite-vector.child.ts against a cached handle.
// Usage: node measure-reopen.mjs <agent-dev.sqlite> <agent-main.sqlite> <vec0.dylib>
// Prints timings only (no row contents). Query vector is synthetic (seeded PRNG).
import { DatabaseSync } from "node:sqlite";
import { statSync } from "node:fs";
import { performance } from "node:perf_hooks";

const [devPath, mainPath, extPath] = process.argv.slice(2);
const RUNS = 5;
const WARMUP = 2;
const DIMS = 4096;
const LIMIT = 10; // representative maxResults
const K = Math.min(LIMIT * 8, 4096); // sqlite-vector.ts candidateLimit
const SNIPPET = 700;

let seed = 12345;
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) - 0.5;
const vec = new Float32Array(DIMS).map(() => rnd());
const blob = Buffer.from(vec.buffer);

const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const fmt = (xs) => `median=${median(xs).toFixed(3)} ms  runs=[${xs.map((x) => x.toFixed(3)).join(", ")}]`;

const KNN_SQL = `SELECT c.id, c.path, c.start_line, c.end_line,
       CASE WHEN instr(substr(CAST(c.text AS BLOB), 1, ?), x'00') > 0
            THEN CAST(substr(CAST(c.text AS BLOB), 1, ?) AS TEXT)
            ELSE substr(c.text, 1, ?) END AS text,
       c.source,
       vec_distance_cosine(v.embedding, ?) AS dist
  FROM memory_index_chunks_vec v
  CROSS JOIN memory_index_chunks c ON c.id = v.id
 WHERE v.embedding MATCH ? AND k = ? AND c.model = ?
 ORDER BY dist ASC
 LIMIT ?`;

function readModel(path) {
  const db = new DatabaseSync(path, { readOnly: true });
  const row = db.prepare("SELECT model, count(*) AS n FROM memory_index_chunks GROUP BY model ORDER BY n DESC LIMIT 1").get();
  db.close();
  return row.model; // used as a bind parameter only, never printed
}

function openLikeChild(path) {
  const db = new DatabaseSync(path, { readOnly: true, allowExtension: true });
  db.exec("PRAGMA query_only = ON; PRAGMA busy_timeout = 5000");
  return db;
}
function loadVec(db) {
  db.enableLoadExtension(true);
  try {
    db.loadExtension(extPath);
    const v = db.prepare("SELECT vec_version() AS version").get();
    if (typeof v?.version !== "string") throw new Error("vec_version failed");
  } finally {
    db.enableLoadExtension(false);
  }
}
const knnParams = (model) => [SNIPPET * 4, SNIPPET * 4, SNIPPET, blob, blob, K, model, LIMIT];

console.log(`node ${process.version}`);
{
  const db = new DatabaseSync(":memory:");
  console.log(`sqlite_version ${db.prepare("SELECT sqlite_version() AS v").get().v}`);
  db.close();
}
console.log(`extension ${extPath}`);
console.log(`runs=${RUNS} (median reported) after ${WARMUP} warmup iterations; limit=${LIMIT} k=${K} dims=${DIMS}`);

// allowExtension contract
{
  const db = new DatabaseSync(devPath, { readOnly: true });
  try {
    db.enableLoadExtension(true);
    console.log("allowExtension omitted: enableLoadExtension(true) did not throw");
  } catch (e) {
    console.log(`allowExtension omitted: enableLoadExtension(true) throws: ${e.code ?? ""} ${e.message}`);
  }
  try {
    db.loadExtension(extPath);
    console.log("allowExtension omitted: loadExtension did not throw");
  } catch (e) {
    console.log(`allowExtension omitted: loadExtension throws: ${e.code ?? ""} ${e.message}`);
  }
  db.close();
}

const model = readModel(devPath);

// (a) per-request cycle, phase by phase, as sqlite-vector.child.ts run() does it
const phases = { open_pragmas: [], load_vec_and_version: [], first_prepare: [], knn_all: [], close: [], total: [] };
let idsA;
for (let i = 0; i < WARMUP + RUNS; i++) {
  const t0 = performance.now();
  const db = openLikeChild(devPath);
  const t1 = performance.now();
  loadVec(db);
  const t2 = performance.now();
  const stmt = db.prepare(KNN_SQL);
  const t3 = performance.now();
  const rows = stmt.all(...knnParams(model));
  const t4 = performance.now();
  db.close();
  const t5 = performance.now();
  if (i >= WARMUP) {
    phases.open_pragmas.push(t1 - t0);
    phases.load_vec_and_version.push(t2 - t1);
    phases.first_prepare.push(t3 - t2);
    phases.knn_all.push(t4 - t3);
    phases.close.push(t5 - t4);
    phases.total.push(t5 - t0);
  }
  idsA = JSON.stringify(rows.map((r) => [r.id, r.dist]));
}
console.log("\n(a) reopen per request on agent-dev.sqlite (open+pragmas, loadExtension+vec_version, prepare, KNN .all, close)");
for (const [k, v] of Object.entries(phases)) console.log(`  ${k.padEnd(22)} ${fmt(v)}`);
console.log(`  overhead_excl_knn      median=${median(phases.total.map((t, i) => t - phases.knn_all[i])).toFixed(3)} ms`);

// (b) cached handle: stat identity check + prepare + KNN .all on an already-open handle
const cached = openLikeChild(devPath);
loadVec(cached);
const ident = () => {
  const s = statSync(devPath, { bigint: true });
  return `${s.dev}:${s.ino}`;
};
const opened = ident();
const bStat = [], bPrepare = [], bKnn = [], bTotal = [];
let idsB;
for (let i = 0; i < WARMUP + RUNS; i++) {
  const t0 = performance.now();
  if (ident() !== opened) throw new Error("identity changed");
  const t1 = performance.now();
  const stmt = cached.prepare(KNN_SQL);
  const t2 = performance.now();
  const rows = stmt.all(...knnParams(model));
  const t3 = performance.now();
  if (i >= WARMUP) {
    bStat.push(t1 - t0); bPrepare.push(t2 - t1); bKnn.push(t3 - t2); bTotal.push(t3 - t0);
  }
  idsB = JSON.stringify(rows.map((r) => [r.id, r.dist]));
}
console.log("\n(b) cached handle on agent-dev.sqlite (stat dev/ino check, prepare, KNN .all)");
console.log(`  stat_identity          ${fmt(bStat)}`);
console.log(`  prepare                ${fmt(bPrepare)}`);
console.log(`  knn_all                ${fmt(bKnn)}`);
console.log(`  total                  ${fmt(bTotal)}`);
console.log(`  in transaction between requests: ${cached.isTransaction}`);
console.log(`\nKNN results identical (a) vs (b): ${idsA === idsB} (rows=${JSON.parse(idsB).length})`);
cached.close();

// open+close and open+schema-touch on both DB sizes, without the extension
for (const [label, path] of [["agent-dev.sqlite", devPath], ["agent-main.sqlite", mainPath]]) {
  const size = statSync(path).size;
  const oc = [], schema = [];
  let masterRows = 0;
  for (let i = 0; i < WARMUP + RUNS; i++) {
    let t0 = performance.now();
    let db = new DatabaseSync(path, { readOnly: true });
    db.close();
    let t1 = performance.now();
    if (i >= WARMUP) oc.push(t1 - t0);
    t0 = performance.now();
    db = new DatabaseSync(path, { readOnly: true });
    db.exec("PRAGMA query_only = ON; PRAGMA busy_timeout = 5000");
    masterRows = db.prepare("SELECT count(*) AS n FROM sqlite_master").get().n; // forces schema parse
    db.close();
    t1 = performance.now();
    if (i >= WARMUP) schema.push(t1 - t0);
  }
  console.log(`\n${label} bytes=${size} sqlite_master_rows=${masterRows}`);
  console.log(`  open+close                    ${fmt(oc)}`);
  console.log(`  open+pragmas+schema+close     ${fmt(schema)}`);
}
