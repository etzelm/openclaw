// Drive the real sqlite-vec KNN child (dist/infra/database-engine/sqlite-vector.child.js)
// through its production stdin/stdout protocol with the production memory_search plan
// (limit 24, k 192 after the child's limit * 8 widening), one child reused across requests
// exactly as the parent does, reopening the database per request inside the child.
//
// Usage: node measure-child.mjs <child.js> <agent.sqlite> <label> [sources=memory,sessions]
// Env: RUNS (default 5), WARM (default 2), LIMIT (default 24), SNIPPET (default 700)
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createInterface } from "node:readline";
import { DatabaseSync } from "node:sqlite";
import { performance } from "node:perf_hooks";
import { serialize } from "node:v8";

const [childPath, dbPath, label = "arm", sourcesArg = ""] = process.argv.slice(2);
const RUNS = Number(process.env.RUNS ?? 5);
const WARM = Number(process.env.WARM ?? 2);
const LIMIT = Number(process.env.LIMIT ?? 24);
const SNIPPET = Number(process.env.SNIPPET ?? 700);
const sources = sourcesArg ? sourcesArg.split(",") : [];

const meta = new DatabaseSync(dbPath, { readOnly: true });
const { model, dims } = meta
  .prepare(
    "SELECT model, count(*) AS n, (SELECT length(embedding) / 8 FROM memory_index_chunks LIMIT 1) AS dims FROM memory_index_chunks GROUP BY model ORDER BY n DESC LIMIT 1",
  )
  .get();
// vec0 is not loaded here; the shadow rowid table counts the same rows.
const vectorCount = meta
  .prepare("SELECT count(*) AS n FROM memory_index_chunks_vec_rowids")
  .get().n;
meta.close();

// Deterministic synthetic query vector (same generator as the audit scripts).
let seed = 12345;
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) - 0.5;
const blob = Buffer.from(new Float32Array(dims).map(() => rnd()).buffer);

const sourceSql = sources.length ? ` AND c.source IN (${sources.map(() => "?").join(", ")})` : "";
const query = {
  sql: `SELECT c.id, c.path, c.start_line, c.end_line,
       CASE WHEN instr(substr(CAST(c.text AS BLOB), 1, ?), x'00') > 0
            THEN CAST(substr(CAST(c.text AS BLOB), 1, ?) AS TEXT)
            ELSE substr(c.text, 1, ?) END AS text,
       c.source,
       vec_distance_cosine(v.embedding, ?) AS dist
  FROM memory_index_chunks_vec v
  CROSS JOIN memory_index_chunks c ON c.id = v.id
 WHERE v.embedding MATCH ? AND k = ? AND c.model = ?${sourceSql}
 ORDER BY dist ASC
 LIMIT ?`,
  parameters: [SNIPPET * 4, SNIPPET * 4, SNIPPET, blob, blob, 0, model, ...sources, LIMIT],
};
const plan = {
  query,
  scopeCount: {
    sql: `SELECT COUNT(*) AS count FROM (
  SELECT 1 FROM memory_index_chunks c WHERE c.model = ?${sourceSql} LIMIT ?
)`,
    parameters: [model, ...sources, LIMIT],
  },
  vectorTable: "memory_index_chunks_vec",
  limit: LIMIT,
  candidateParameter: 5,
  rowShape: {
    id: "string",
    path: "string",
    start_line: "number",
    end_line: "number",
    text: "string",
    source: ["memory", "sessions"],
    dist: "finite-number",
  },
  textPrefix: { column: "text", maxChars: SNIPPET },
};
const input =
  JSON.stringify({ databasePath: dbPath, request: serialize(plan).toString("base64") }) + "\n";

const child = spawn(process.execPath, [childPath], {
  stdio: ["pipe", "pipe", "pipe"],
  env: { PATH: process.env.PATH },
});
child.stderr.on("data", (chunk) => process.stderr.write(`[child stderr] ${chunk}`));
const lines = createInterface({ input: child.stdout });
const pending = [];
lines.on("line", (line) => pending.shift()?.(line));
const request = () =>
  new Promise((resolve) => {
    pending.push(resolve);
    child.stdin.write(input);
  });

const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const times = [];
let signature;
let rowCount = 0;
for (let i = 0; i < WARM + RUNS; i++) {
  const t0 = performance.now();
  const line = await request();
  const t1 = performance.now();
  const result = JSON.parse(line);
  if (result.status !== "ok") {
    throw new Error(`child failed: ${result.error}`);
  }
  if (result.value.fallbackScanRequired) {
    throw new Error("child requested fallback scan");
  }
  const rows = result.value.rows.map((r) => [r.id, r.path, r.start_line, r.end_line, r.text, r.source, r.dist]);
  const sig = createHash("sha256").update(JSON.stringify(rows)).digest("hex").slice(0, 16);
  if (signature && sig !== signature) {
    throw new Error(`rows changed between requests: ${signature} vs ${sig}`);
  }
  signature = sig;
  rowCount = rows.length;
  if (i >= WARM) {
    times.push(t1 - t0);
  }
}
// Resident size of the child after the last request (page cache is released at
// connection close, so this is the post-query steady state, not the in-query peak).
const rssKiB = Number(execFileSync("ps", ["-o", "rss=", "-p", String(child.pid)]).toString().trim());
child.stdin.end();
await new Promise((resolve) => child.once("close", resolve));
console.log(
  `${label.padEnd(8)} node ${process.version} db=${dbPath.split("/").pop()} vectors=${vectorCount} dims=${dims} limit=${LIMIT} k=${Math.min(LIMIT * 8, 4096)} sources=[${sources.join(",")}]`,
);
console.log(
  `${"".padEnd(8)} rows=${rowCount} sha256(rows)=${signature} median=${median(times).toFixed(3)} ms runs=[${times.map((x) => x.toFixed(1)).join(", ")}] child rss after last request=${(rssKiB / 1024).toFixed(1)} MiB (medians of ${RUNS} after ${WARM} warmups, one reused child, reopen per request)`,
);
