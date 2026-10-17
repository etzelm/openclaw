import { DatabaseSync } from "node:sqlite";
const db = new DatabaseSync(process.argv[2], { readOnly: true });
const o = {}; for (const t of ["memory_index_chunks","memory_index_chunks_fts","memory_index_chunks_fts_docsize"]) o[t] = db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n;
console.log(JSON.stringify(o)); db.close();
