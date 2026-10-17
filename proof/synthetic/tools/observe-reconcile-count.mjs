// Read-only observer for the t1-02 proof, loaded with
//   NODE_OPTIONS="--import=<abs path>/observe-reconcile-count.mjs"
// It changes no OpenClaw source. It wraps node:sqlite DatabaseSync.prototype.prepare and,
// for the one statement that contains "derived_count" (reconcileMemoryChunkFtsRows),
// records the SQL, its EXPLAIN QUERY PLAN, the returned counts and the step time.
// One JSON line per observed statement is appended to $T102_OBSERVE_OUT.
// Records contain no row contents and no directories: pid, thread, SQL, plan, counts, ms,
// and calling function names with dist file basenames.
import fs from "node:fs";
import { isMainThread, threadId } from "node:worker_threads";
import { DatabaseSync } from "node:sqlite";

const out = process.env.T102_OBSERVE_OUT;
if (out) {
  const originalPrepare = DatabaseSync.prototype.prepare;
  let inside = false;
  DatabaseSync.prototype.prepare = function prepare(sql, ...rest) {
    const stmt = originalPrepare.call(this, sql, ...rest);
    if (inside || typeof sql !== "string" || !sql.includes("derived_count")) {
      return stmt;
    }
    const db = this;
    const originalGet = stmt.get;
    stmt.get = function get(...args) {
      const started = process.hrtime.bigint();
      const row = originalGet.apply(this, args);
      const ms = Number(process.hrtime.bigint() - started) / 1e6;
      let plan = [];
      inside = true;
      try {
        plan = originalPrepare
          .call(db, `EXPLAIN QUERY PLAN ${sql}`)
          .all()
          .map((r) => r.detail);
      } catch (error) {
        plan = [`explain failed: ${String(error?.message ?? error)}`];
      } finally {
        inside = false;
      }
      // Function names of the calling frames (dist file basenames only, no directories),
      // so the record shows which admission path ran the statement.
      const callers = (new Error().stack ?? "")
        .split("\n")
        .slice(2, 12)
        .map((line) => line.trim().replace(/^at /, "").replace(/\(?(?:file:\/\/)?\/[^)]*\/([^/)]+)\)?/, "($1)"));
      const record = {
        event: "reconcile_count",
        pid: process.pid,
        threadId,
        isMainThread,
        inTransaction: db.isTransaction,
        sql: sql.replace(/\s+/g, " ").trim(),
        plan,
        canonical_count: row?.canonical_count,
        derived_count: row?.derived_count,
        stmt_ms: Number(ms.toFixed(3)),
        callers,
      };
      fs.appendFileSync(out, `${JSON.stringify(record)}\n`);
      return row;
    };
    return stmt;
  };
}
