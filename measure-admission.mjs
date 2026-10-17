// Time one whole memory schema admission with the BUILT production modules, once per fresh node process.
//
// The production publication worker (extensions/memory-core/src/memory/manager-publication.worker.ts,
// "schema.admit" handler) runs: PRAGMA foreign_keys = OFF; busy_timeout 0; BEGIN IMMEDIATE;
// ensureMemoryIndexSchema({cacheEnabled, ftsEnabled, ftsTokenizer, db}); COMMIT; admitSqliteSchema(db).
// That handler is not reachable from dist without the host admission broker, and the agent-database
// opener refuses these snapshots (schema version 24 needs doctor --fix), so this harness drives the same
// exported production functions on a connection opened like the worker's private-shadow opener
// (openNodeSqliteDatabase + configureMemorySqliteWalMaintenance busyTimeoutMs 5000).
//
// Usage: node measure-admission.mjs <tree-root> <db-path> <label>
// Env: CALLS (default 1) back-to-back admissions in this process (call 2+ = already-admitted path).
// Prints JSON lines only: timings, flags, counts, versions. Never prints row contents, paths or ids.
import { performance } from "node:perf_hooks";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";

const [tree, dbPath, label = "arm"] = process.argv.slice(2);
const CALLS = Number(process.env.CALLS ?? 1);
const out = (o) => console.log(JSON.stringify({ label, ...o }));

// Observe only: count which admission path ran and time the reconcile count statement itself.
const origPrepare = DatabaseSync.prototype.prepare;
const origExec = DatabaseSync.prototype.exec;
let seen = { savepoint: 0, derivedStatements: 0, derivedMs: 0 };
DatabaseSync.prototype.prepare = function (sql, ...rest) {
  const stmt = origPrepare.call(this, sql, ...rest);
  if (typeof sql === "string" && sql.includes("derived_count")) {
    const get = stmt.get.bind(stmt);
    stmt.get = (...a) => {
      const t = performance.now();
      const r = get(...a);
      seen.derivedMs += performance.now() - t;
      seen.derivedStatements++;
      return r;
    };
  }
  return stmt;
};
DatabaseSync.prototype.exec = function (sql, ...rest) {
  if (typeof sql === "string" && sql.includes("SAVEPOINT ensure_memory_search") && !sql.includes("RELEASE")) {
    seen.savepoint++;
  }
  return origExec.call(this, sql, ...rest);
};

const imp = (f) => import(pathToFileURL(`${tree}/dist/plugin-sdk/${f}.js`).href);
const storage = await imp("memory-core-host-engine-storage");
const sqliteWorker = await imp("sqlite-worker-runtime");

const t0 = performance.now();
const db = sqliteWorker.openNodeSqliteDatabase(dbPath, { allowExtension: false });
storage.configureMemorySqliteWalMaintenance(db, { busyTimeoutMs: 5000, databasePath: dbPath });
const open_ms = performance.now() - t0;
const fk = Object.values(origPrepare.call(db, "PRAGMA foreign_keys").get())[0];
const one = (sql) => origPrepare.call(db, sql).get();
const input = { cacheEnabled: true, ftsEnabled: true, ftsTokenizer: "unicode61" };
out({ phase: "open", open_ms: Number(open_ms.toFixed(3)), journal_mode: one("PRAGMA journal_mode").journal_mode, busy_timeout: one("PRAGMA busy_timeout").timeout });

for (let call = 1; call <= CALLS; call++) {
  seen = { savepoint: 0, derivedStatements: 0, derivedMs: 0 };
  const a = performance.now();
  let result;
  let error;
  try {
    db.exec("PRAGMA foreign_keys = OFF");
    sqliteWorker.setSqliteBusyTimeout(db, 0);
    result = sqliteWorker.runSqliteImmediateTransactionSync(db, () =>
      storage.ensureMemoryIndexSchema({ ...input, db }),
    );
    sqliteWorker.setSqliteBusyTimeout(db, 5000);
    sqliteWorker.admitSqliteSchema(db);
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  } finally {
    db.exec(`PRAGMA foreign_keys = ${fk}`);
  }
  const ms = performance.now() - a;
  out({
    phase: "schema.admit",
    call,
    admit_ms: Number(ms.toFixed(3)),
    ok: error === undefined,
    ftsAvailable: result?.ftsAvailable,
    ftsError: result?.ftsError ? "present" : undefined,
    path: seen.savepoint > 0 ? "first-admission" : "admitted",
    reconcile_count_statements: seen.derivedStatements,
    reconcile_count_stmt_ms: Number(seen.derivedMs.toFixed(3)),
    total_changes: one("SELECT total_changes() AS n").n,
    error,
  });
}

const timed = (sql) => {
  const t = performance.now();
  const n = Object.values(one(sql))[0];
  return [n, Number((performance.now() - t).toFixed(3))];
};
const [canonical, canonical_ms] = timed("SELECT COUNT(*) AS n FROM memory_index_chunks");
const [fts, fts_ms] = timed("SELECT COUNT(*) AS n FROM memory_index_chunks_fts");
const [docsize, docsize_ms] = timed("SELECT COUNT(*) AS n FROM memory_index_chunks_fts_docsize");
out({
  phase: "counts",
  node: process.version,
  sqlite: one("SELECT sqlite_version() AS v").v,
  canonical_count: canonical,
  fts_count: fts,
  docsize_count: docsize,
  counts_equal: canonical === fts && fts === docsize,
  canonical_ms,
  fts_count_ms: fts_ms,
  docsize_count_ms: docsize_ms,
  note: "same connection as the admission; FTS count here is warm because BEFORE already scanned it",
});
db.close();
