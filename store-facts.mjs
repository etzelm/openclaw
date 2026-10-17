// Read-only structural facts about a memory store. Counts, sizes, DDL of the FTS tables, query plans only.
// Usage: node store-facts.mjs <db-path> <label>
import { DatabaseSync } from "node:sqlite";
import { statSync } from "node:fs";
const [p, label] = process.argv.slice(2);
const db = new DatabaseSync(p, { readOnly: true });
const one = (s) => db.prepare(s).get();
const n = (t) => Object.values(one(`SELECT COUNT(*) AS n FROM ${t}`))[0];
const line = (k, v) => console.log(`${k}: ${v}`);
line("store", label);
line("node", process.version);
line("sqlite", one("SELECT sqlite_version() AS v").v);
line("file_bytes", statSync(p).size);
line("page_size", one("PRAGMA page_size").page_size);
line("memory_index_chunks rows", n("memory_index_chunks"));
line("memory_index_chunks_fts COUNT(*)", n("memory_index_chunks_fts"));
line("memory_index_chunks_fts_docsize COUNT(*)", n("memory_index_chunks_fts_docsize"));
for (const r of db.prepare("SELECT name, sql FROM sqlite_schema WHERE name IN ('memory_index_chunks_fts','memory_index_chunks_fts_docsize','memory_index_chunks_fts_content') ORDER BY name").all()) {
  line(`DDL ${r.name}`, (r.sql ?? "(none)").replace(/\s+/g, " "));
}
try {
  for (const t of ["memory_index_chunks_fts_content", "memory_index_chunks_fts_docsize"]) {
    const r = one(`SELECT SUM(pgsize) AS bytes, COUNT(*) AS pages FROM dbstat WHERE name = '${t}'`);
    line(`dbstat ${t}`, `bytes=${r.bytes} pages=${r.pages}`);
  }
} catch (e) {
  line("dbstat", `unavailable: ${e.message}`);
}
const plan = (tag, d) => {
  const sql = `SELECT (SELECT COUNT(*) FROM memory_index_chunks) AS canonical_count, (SELECT COUNT(*) FROM ${d}) AS derived_count`;
  for (const r of db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all()) line(`plan ${tag}`, `id=${r.id} parent=${r.parent} ${r.detail}`);
};
plan("BEFORE (FROM memory_index_chunks_fts)", "memory_index_chunks_fts");
plan("AFTER (FROM memory_index_chunks_fts_docsize)", "memory_index_chunks_fts_docsize");
db.close();
