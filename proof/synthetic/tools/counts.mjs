// usage: node counts.mjs <dbcopy>
import { DatabaseSync } from "node:sqlite";
const db = new DatabaseSync(process.argv[2], { readOnly: true });
const o = {};
for (const t of ["memory_index_chunks","memory_index_chunks_fts","memory_index_chunks_fts_docsize","memory_index_sources"]) {
  try { o[t] = db.prepare(`SELECT COUNT(*) c FROM ${t}`).get().c; } catch (e) { o[t] = "ERR " + e.message; }
}
o.user_version = db.prepare("PRAGMA user_version").get().user_version;
o.sqlite_version = db.prepare("SELECT sqlite_version() v").get().v;
const cols = db.prepare("PRAGMA table_info(memory_index_chunks)").all().map((c) => c.name);
o.chunk_columns = cols;
if (cols.includes("model")) o.models = db.prepare("SELECT model, COUNT(*) c FROM memory_index_chunks GROUP BY model").all().map((r)=>({model:r.model,count:r.c}));
console.log(JSON.stringify(o, null, 1));
