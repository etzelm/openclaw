// Read-only observer for the t1-01 proof. Load with NODE_OPTIONS="--import=file://<abs>/observe-search-prepare.mjs".
// Changes no OpenClaw source. Env: T101_OBSERVE_OUT=<jsonl path>; T101_AUTH=0 disables the counting
// authorizer and EXPLAIN QUERY PLAN (timing-only variant). Bound values are never written.
import fs from "node:fs";
import { threadId, isMainThread } from "node:worker_threads";
import { DatabaseSync, constants } from "node:sqlite";
import crypto from "node:crypto";

const out = process.env.T101_OBSERVE_OUT;
const AUTH = process.env.T101_AUTH !== "0";
if (out) {
  const P = DatabaseSync.prototype;
  const origPrepare = P.prepare;
  const origFunction = P.function;
  const origSetAuth = P.setAuthorizer;
  const OK = constants.SQLITE_OK;
  const READ = constants.SQLITE_READ;
  const w = (rec) => fs.appendFileSync(out, `${JSON.stringify({ t: Date.now(), pid: process.pid, thr: threadId, ...rec })}\n`);
  const ids = new WeakMap();
  let nextId = 1;
  const dbId = (db) => { let i = ids.get(db); if (!i) { i = nextId++; ids.set(db, i); } return i; };
  const st = new WeakMap(); // db -> { appCb, installed }
  let ep = null; // current compile episode counters
  let inside = false; // re-entrancy guard (EQP)
  let ctx = null; // { where, shape }
  const newEp = () => ({ cb: 0, reads: {} });
  const counting = (appCb) => (...args) => {
    if (!inside && ep) {
      ep.cb += 1;
      if (args[0] === READ) ep.reads[args[1]] = (ep.reads[args[1]] ?? 0) + 1;
    }
    return appCb ? appCb(...args) : OK;
  };
  P.setAuthorizer = function setAuthorizer(cb) {
    const s = st.get(this);
    if (s) {
      s.appCb = typeof cb === "function" ? cb : null;
      w({ ev: "app_set_authorizer", db: dbId(this), appCb: s.appCb !== null });
      return origSetAuth.call(this, counting(s.appCb));
    }
    return origSetAuth.call(this, cb);
  };
  P.function = function fn(name, ...rest) {
    const r = origFunction.call(this, name, ...rest);
    if (typeof name === "string" && name.startsWith("openclaw_memory_")) {
      w({ ev: "fn", db: dbId(this), name });
    }
    return r;
  };
  const shapeOf = (sql) => {
    const s = sql;
    if (s.includes("derived_count")) return "reconcile_count";
    if (s.includes("pattern_candidates")) return s.includes("exact_paths") ? "path_exact" : "path_exact_candidates";
    if (s.includes("retained_paths")) return "path_lexical";
    if (s.includes("memory_index_paths_fts")) return "path_fts_other";
    if (s.includes("memory_index_chunks_fts")) return "chunk_keyword";
    return "other";
  };
  const flush = (where, shape, sqlHash) => {
    if (ep && ep.cb > 0) {
      w({ ev: "episode", where, shape, sqlHash, cb: ep.cb, readChunks: ep.reads.memory_index_chunks ?? 0, reads: ep.reads });
    }
    ep = null;
  };
  const eqpDone = new Set();
  P.prepare = function prepare(sql, ...rest) {
    if (inside || typeof sql !== "string" || !(sql.includes("memory_index_chunks_fts") || sql.includes("memory_index_paths_fts"))) {
      return origPrepare.call(this, sql, ...rest);
    }
    const db = this;
    const collapsed = sql.replace(/\s+/g, " ").trim();
    const sqlHash = crypto.createHash("sha256").update(collapsed).digest("hex").slice(0, 12);
    const shape = shapeOf(collapsed);
    if (AUTH && !st.has(db)) {
      st.set(db, { appCb: null });
      origSetAuth.call(db, counting(null));
      w({ ev: "auth_install", db: dbId(db) });
    }
    ep = newEp();
    const t0 = process.hrtime.bigint();
    const stmt = origPrepare.call(db, sql, ...rest);
    const us = Number(process.hrtime.bigint() - t0) / 1e3;
    w({ ev: "prepare", db: dbId(db), shape, sqlHash, us: Number(us.toFixed(1)), sql: collapsed });
    flush("prepare", shape, sqlHash);
    for (const m of ["all", "get", "iterate", "run"]) {
      const orig = stmt[m];
      if (typeof orig !== "function") continue;
      stmt[m] = function wrapped(...args) {
        if (AUTH && !eqpDone.has(sqlHash)) {
          eqpDone.add(sqlHash);
          inside = true;
          let plan;
          try {
            plan = origPrepare.call(db, `EXPLAIN QUERY PLAN ${sql}`).all(...args).map((r) => r.detail);
          } catch (e) { plan = [`explain failed: ${String(e?.message ?? e)}`]; }
          finally { inside = false; }
          w({ ev: "eqp", db: dbId(db), shape, sqlHash, plan });
        }
        ep = newEp();
        const a = process.hrtime.bigint();
        let res;
        try { res = orig.apply(this, args); } finally {
          const us2 = Number(process.hrtime.bigint() - a) / 1e3;
          const rows = Array.isArray(res) ? res.length : undefined;
          w({ ev: "run", db: dbId(db), shape, sqlHash, m, us: Number(us2.toFixed(1)), rows });
          flush("run", shape, sqlHash);
        }
        return res;
      };
    }
    return stmt;
  };
}
