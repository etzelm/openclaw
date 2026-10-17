import { DatabaseSync } from "node:sqlite";
const p = process.argv[2];
const db = new DatabaseSync(p);
const c = () => { const o = {}; for (const t of ["memory_index_chunks","memory_index_chunks_fts","memory_index_chunks_fts_docsize"]) o[t] = db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n; return o; };
console.log("TEST-ONLY FAULT INJECTION");
console.log("before", JSON.stringify(c()));
db.exec("DELETE FROM memory_index_chunks_fts WHERE rowid IN (SELECT rowid FROM memory_index_chunks_fts ORDER BY rowid LIMIT 10)");
console.log("after", JSON.stringify(c()));
db.close(); console.log("closed");
