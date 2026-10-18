// Read-only instrument for the t2-03 proof, loaded with NODE_OPTIONS="--import=file://<tools>/observe-vector-serialization.mjs".
// Node applies it to worker threads too. It never changes a value, statement, parameter or result.
//  1. JSON.stringify: per thread, calls whose first argument is an Array of >=1 numbers only ("numarr":
//     calls, items = printed coordinates, output chars, ms inside), typed-array first arguments
//     ("typed"), and calls whose first argument is a single number ("num": calls, output chars, ms).
//  2. JSON.parse: per thread, calls, input chars, ms.
//  3. node:sqlite: INSERT/UPDATE/DELETE/REPLACE on tables starting "memory_" and SELECT on the embedding
//     cache: op, table, rows, first 160 chars of SQL. No parameters, no row contents.
//  4. Per-thread totals (also flushed every 2000 wrapped calls and on exit); main thread includes
//     process.cpuUsage(); every thread includes process.threadCpuUsage() when available.
// Output: JSONL appended to $T203_OBSERVE_OUT.
import fs from "node:fs";
import { performance } from "node:perf_hooks";
import { isMainThread, threadId } from "node:worker_threads";
import { DatabaseSync } from "node:sqlite";

const out = process.env.T203_OBSERVE_OUT;
if (out) {
  const origStringify = JSON.stringify;
  const origParse = JSON.parse;
  const now = () => performance.now();
  const t = {
    numarr: { calls: 0, items: 0, outChars: 0, ms: 0, maxItems: 0 },
    typed: { calls: 0, items: 0, outChars: 0, ms: 0 },
    num: { calls: 0, outChars: 0, ms: 0 },
    parse: { calls: 0, inChars: 0, ms: 0 },
    stringifyAll: { calls: 0 },
  };
  let wrapped = 0;
  const w = (obj) => fs.appendFileSync(out, `${origStringify(obj)}\n`);
  const totals = (event) => {
    const rec = { event, pid: process.pid, threadId, isMainThread, at: Date.now(), ...t };
    try { rec.threadCpu = process.threadCpuUsage?.(); } catch {}
    if (isMainThread) rec.processCpu = process.cpuUsage();
    rec.rss = process.memoryUsage().rss;
    w(rec);
  };
  w({ event: "observer-loaded", pid: process.pid, threadId, isMainThread, at: Date.now() });
  const every = isMainThread ? 5000 : 20; // workers may be terminated without an exit event: flush often
  const tick = () => { if (++wrapped % every === 0) totals("totals-interim"); };

  JSON.stringify = function stringify(value, ...rest) {
    t.stringifyAll.calls++;
    let kind = 0;
    let items = 0;
    if (typeof value === "number") kind = 3;
    else if (Array.isArray(value)) {
      const n = value.length;
      if (n > 0) {
        let ok = true;
        for (let i = 0; i < n; i++) if (typeof value[i] !== "number") { ok = false; break; }
        if (ok) { kind = 1; items = n; }
      }
    } else if (ArrayBuffer.isView(value) && !(value instanceof DataView)) { kind = 2; items = value.length; }
    if (kind === 0) return Reflect.apply(origStringify, this, [value, ...rest]);
    const t0 = now();
    let r;
    try { r = Reflect.apply(origStringify, this, [value, ...rest]); }
    finally {
      const dt = now() - t0;
      const len = typeof r === "string" ? r.length : 0;
      if (kind === 1) { const a = t.numarr; a.calls++; a.items += items; a.outChars += len; a.ms += dt; if (items > a.maxItems) a.maxItems = items; }
      else if (kind === 2) { const a = t.typed; a.calls++; a.items += items; a.outChars += len; a.ms += dt; }
      else { const a = t.num; a.calls++; a.outChars += len; a.ms += dt; }
      tick();
    }
    return r;
  };
  JSON.parse = function parse(text, ...rest) {
    const t0 = now();
    try { return Reflect.apply(origParse, this, [text, ...rest]); }
    finally {
      t.parse.calls++;
      t.parse.inChars += typeof text === "string" ? text.length : 0;
      t.parse.ms += now() - t0;
      tick();
    }
  };
  process.on("exit", () => totals("totals-final"));

  // ---- sqlite observer (from t2-02) ----
  const WRITE = /^\s*(?:with\b[\s\S]*?\)\s*)?(insert(?:\s+or\s+\w+)?\s+into|replace\s+into|update(?:\s+or\s+\w+)?|delete\s+from)\s+["`]?(\w+)["`]?/i;
  const CACHE_READ = /^\s*select\b[\s\S]*\bfrom\s+["`]?(\w*embedding_cache\w*)["`]?/i;
  const classify = (sql) => {
    if (typeof sql !== "string") return null;
    const m = WRITE.exec(sql);
    if (m && m[2].toLowerCase().startsWith("memory_")) return { op: m[1].split(/\s+/)[0].toLowerCase(), table: m[2] };
    const r = CACHE_READ.exec(sql);
    return r ? { op: "select", table: r[1] } : null;
  };
  const record = (kind, sql, extra) => w({
    ev: "sql", pid: process.pid, threadId, isMainThread, op: kind.op, table: kind.table, ...extra,
    sql: sql.replace(/\s+/g, " ").trim().slice(0, 160),
  });
  const originalPrepare = DatabaseSync.prototype.prepare;
  DatabaseSync.prototype.prepare = function prepare(sql, ...rest) {
    const stmt = originalPrepare.call(this, sql, ...rest);
    const kind = classify(sql);
    if (!kind) return stmt;
    for (const method of ["run", "all", "get"]) {
      const original = stmt[method];
      if (typeof original !== "function") continue;
      stmt[method] = function wrappedStmt(...args) {
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
