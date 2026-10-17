// Read-only observer for the t2-02 proof, loaded with
//   NODE_OPTIONS="--import=file://<tools>/observe-memory-writes.mjs"
// Node applies NODE_OPTIONS preloads to worker threads too. It changes no OpenClaw source and
// never alters a statement, a parameter or a result. It wraps node:sqlite and, for every
// INSERT/UPDATE/DELETE/REPLACE whose target table name starts with "memory_", and every
// SELECT that reads an embedding cache table, appends one JSON line to $T202_OBSERVE_OUT:
// pid, thread, operation, table, rows changed (or rows returned), and the first 160 characters
// of the normalized SQL. Bound parameters and row contents are not recorded. For writes to
// memory_index_chunks and memory_index_chunks_vec it also records the basenames of the built
// modules on the stack (no directories), which shows the statement came from the arm's dist.
import fs from "node:fs";
import { isMainThread, threadId } from "node:worker_threads";
import { DatabaseSync } from "node:sqlite";

const out = process.env.T202_OBSERVE_OUT;
const WRITE = /^\s*(?:with\b[\s\S]*?\)\s*)?(insert(?:\s+or\s+\w+)?\s+into|replace\s+into|update(?:\s+or\s+\w+)?|delete\s+from)\s+["`]?(\w+)["`]?/i;
const CACHE_READ = /^\s*select\b[\s\S]*\bfrom\s+["`]?(\w*embedding_cache\w*)["`]?/i;

function classify(sql) {
  if (typeof sql !== "string") return null;
  const w = WRITE.exec(sql);
  if (w && w[2].toLowerCase().startsWith("memory_")) {
    return { op: w[1].split(/\s+/)[0].toLowerCase(), table: w[2] };
  }
  const r = CACHE_READ.exec(sql);
  if (r) return { op: "select", table: r[1] };
  return null;
}
function frames() {
  const previous = Error.stackTraceLimit;
  Error.stackTraceLimit = 40;
  const stack = new Error().stack ?? "";
  Error.stackTraceLimit = previous;
  const names = [];
  for (const line of stack.split("\n").slice(3)) {
    const m = /([^/\\()\s]+\.(?:m?js|cjs)):\d+:\d+\)?\s*$/.exec(line);
    if (m && !m[1].startsWith("observe-memory-writes") && names.at(-1) !== m[1]) names.push(m[1]);
  }
  return names;
}
function record(kind, sql, extra) {
  const withFrames = kind.op !== "select" && /^memory_index_chunks(?:_vec)?$/.test(kind.table) ? { frames: frames() } : {};
  fs.appendFileSync(out, `${JSON.stringify({
    pid: process.pid, threadId, isMainThread, op: kind.op, table: kind.table, ...extra, ...withFrames,
    sql: sql.replace(/\s+/g, " ").trim().slice(0, 160),
  })}\n`);
}
if (out) {
  fs.appendFileSync(out, `${JSON.stringify({ event: "observer-loaded", pid: process.pid, threadId, isMainThread })}\n`);
  const originalPrepare = DatabaseSync.prototype.prepare;
  DatabaseSync.prototype.prepare = function prepare(sql, ...rest) {
    const stmt = originalPrepare.call(this, sql, ...rest);
    const kind = classify(sql);
    if (!kind) return stmt;
    for (const method of ["run", "all", "get"]) {
      const original = stmt[method];
      if (typeof original !== "function") continue;
      stmt[method] = function wrapped(...args) {
        const result = original.apply(this, args);
        if (method === "run") record(kind, sql, { method, changes: Number(result?.changes ?? 0) });
        else if (method === "all") record(kind, sql, { method, rows: Array.isArray(result) ? result.length : 0 });
        else record(kind, sql, { method, rows: result === undefined ? 0 : 1 });
        return result;
      };
    }
    return stmt;
  };
  const originalExec = DatabaseSync.prototype.exec;
  DatabaseSync.prototype.exec = function exec(sql, ...rest) {
    const result = originalExec.call(this, sql, ...rest);
    const kind = classify(sql);
    if (kind) record(kind, sql, { method: "exec" });
    return result;
  };
}
