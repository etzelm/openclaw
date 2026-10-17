// usage: node measure-search.mjs <arm-root> <store> <mode> [--tokenizer unicode61|trigram] [--queries synthetic] [--n N] [--out file.json]
// modes: parity | timing | compiles | plans
// Drives the arm's BUILT searchKeywordWithFallback exactly as executeMemorySearchWorkerQuery does:
//   searchKeywordWithFallback({ ...request.query, db })
// Prints/writes only labels, counts, hashes, timings, SQL shapes and plans (never row content or bound values).
import crypto from "node:crypto";
import fs from "node:fs";
import { DatabaseSync, constants } from "node:sqlite";
import { performance } from "node:perf_hooks";
import { resolveExport } from "./resolve-dist.mjs";
import { openConn, realQueries, buildKeywordRequest, label, WORDS } from "./lib.mjs";

const argv = process.argv.slice(2);
const [armRoot, storePath, mode] = argv;
const opt = (name, dflt) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : dflt;
};
const tokenizer = opt("tokenizer", "unicode61");
const N = Number(opt("n", "400"));
const outFile = opt("out", undefined);
const t0 = performance.now();

const search = await resolveExport(armRoot, "searchKeywordWithFallback");
const { db, method } = await openConn(armRoot, storePath);
let queries;
if (opt("queries", "real") === "synthetic") {
  queries = JSON.parse(fs.readFileSync(opt("queries-file"), "utf8"));
} else {
  queries = realQueries(storePath).queries;
}
const synthetic = opt("queries", "real") === "synthetic";
const qlabel = (i) => (synthetic ? queries[i] : label(i));
const runOne = (q) => search.fn({ ...buildKeywordRequest(q, tokenizer), db });
const sha = (v) => crypto.createHash("sha256").update(v).digest("hex");
const meta = {
  arm: armRoot,
  store: storePath,
  mode,
  tokenizer,
  searchFile: search.file,
  connectionMethod: method,
  node: process.version,
  sqlite: process.versions.sqlite,
  queries: queries.length,
};
const result = { meta };

if (mode === "parity") {
  result.parity = [];
  for (let i = 0; i < queries.length; i++) {
    const r = await runOne(queries[i]);
    result.parity.push({
      q: qlabel(i),
      sha256: sha(JSON.stringify(r)),
      bodyRows: r.body.rows.length,
      pathRows: r.path.rows.length,
      bodyError: r.body.error ? sha(r.body.error).slice(0, 12) : null,
      pathError: r.path.error ? sha(r.path.error).slice(0, 12) : null,
    });
  }
} else if (mode === "timing") {
  for (let pass = 0; pass < 2; pass++) for (const q of queries) await runOne(q);
  const reps = [];
  for (let rep = 0; rep < 5; rep++) {
    const s = process.hrtime.bigint();
    for (let i = 0; i < N; i++) await runOne(queries[i % queries.length]);
    const e = process.hrtime.bigint();
    reps.push(Number(e - s) / 1000 / N);
  }
  result.timing = { searchesPerRep: N, repMeansUs: reps };
} else if (mode === "compiles") {
  // Count compiles. Authorizer installed via the prototype method so the repo's instance wrapper
  // (which drops the statement cache) is bypassed. Installed before the first search.
  let hits = new Map();
  const code = new Map();
  for (const [k, v] of Object.entries(constants)) if (k.startsWith("SQLITE_") && typeof v === "number") if (!code.has(v)) code.set(v, k);
  DatabaseSync.prototype.setAuthorizer.call(db, (action, arg1) => {
    const k = `${code.get(action) ?? action}:${arg1 ?? ""}`;
    hits.set(k, (hits.get(k) ?? 0) + 1);
    return constants.SQLITE_OK;
  });
  let prepares = 0;
  let functions = 0;
  const origPrepare = db.prepare.bind(db);
  Object.defineProperty(db, "prepare", { configurable: true, writable: true, value: (...a) => (prepares++, origPrepare(...a)) });
  const origFunction = db.function.bind(db);
  Object.defineProperty(db, "function", { configurable: true, writable: true, value: (...a) => (functions++, origFunction(...a)) });
  const seq = [...WORDS, WORDS[0], WORDS[1]]; // 10 searches, fixed
  const sequences = { first10: seq.map((w) => (synthetic ? w : w)), all20x3: [...queries, ...queries, ...queries] };
  result.compiles = {};
  for (const [name, list] of Object.entries(sequences)) {
    const rows = [];
    for (let i = 0; i < list.length; i++) {
      hits = new Map();
      prepares = 0;
      functions = 0;
      await runOne(list[i]);
      rows.push({
        search: i + 1,
        q: synthetic || WORDS.includes(list[i]) ? list[i] : qlabel(queries.indexOf(list[i])),
        compilesMemoryIndexChunks: hits.get("SQLITE_READ:memory_index_chunks") ?? 0,
        authorizerCallbacksTotal: [...hits.values()].reduce((a, b) => a + b, 0),
        prepareCalls: prepares,
        functionRegistrations: functions,
        byAction: Object.fromEntries([...hits].sort()),
      });
    }
    result.compiles[name] = rows;
  }
} else if (mode === "plans") {
  const captured = [];
  let capturing = false;
  const origPrepare = db.prepare.bind(db);
  Object.defineProperty(db, "prepare", {
    configurable: true,
    writable: true,
    value: (sql, ...rest) => {
      const st = origPrepare(sql, ...rest);
      if (capturing) {
        for (const m of ["all", "get", "iterate", "run"]) {
          const orig = st[m].bind(st);
          st[m] = (...params) => (captured.push({ sql, params }), orig(...params));
        }
      }
      return st;
    },
  });
  const norm = (sql) =>
    sql.replace(/LIMIT \+\?/g, "LIMIT ?").replace(/\(\? \|\| ''\)/g, "?").replace(/\s+/g, " ").trim();
  const shapes = new Map();
  result.plans = [];
  for (let i = 0; i < queries.length; i++) {
    captured.length = 0;
    capturing = true;
    await runOne(queries[i]);
    capturing = false;
    const stmts = captured.splice(0);
    const per = [];
    for (const { sql, params } of stmts) {
      const shape = sha(norm(sql)).slice(0, 10);
      if (!shapes.has(shape)) shapes.set(shape, { normalizedSql: norm(sql), rawSqls: new Set() });
      shapes.get(shape).rawSqls.add(sql);
      const eqp = origPrepare(`EXPLAIN QUERY PLAN ${sql}`).all(...params);
      per.push({ shape, rawSqlSha: sha(sql).slice(0, 10), plan: eqp.map((r) => `${r.id}|${r.parent}|${r.detail}`) });
    }
    result.plans.push({ q: qlabel(i), statements: per });
  }
  result.shapes = Object.fromEntries([...shapes].map(([k, v]) => [k, { normalizedSql: v.normalizedSql, rawSqls: [...v.rawSqls] }]));
}
result.wallMs = performance.now() - t0;
result.processUptimeMs = process.uptime() * 1000;
const text = JSON.stringify(result);
if (outFile) fs.writeFileSync(outFile, text);
else console.log(text);
db.close?.();
