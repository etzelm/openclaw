// Scratch, in-memory: an existing body FTS table created with columnsize=0 (no %_docsize) goes
// through real admission on this build. Also runs the AFTER count statement directly on it.
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";
const tree = process.argv[2];
const storage = await import(pathToFileURL(`${tree}/dist/plugin-sdk/memory-core-host-engine-storage.js`).href);
const db = new DatabaseSync(":memory:");
storage.ensureMemoryIndexSchema({ db, cacheEnabled: false, ftsEnabled: false });
db.exec(`
  INSERT INTO memory_index_chunks (id, path, source, start_line, end_line, hash, model, text, embedding, updated_at)
  VALUES ('a', 'memory/a.md', 'memory', 1, 1, 'h', 'm', 'alpha body', X'', 1);
  CREATE VIRTUAL TABLE memory_index_chunks_fts USING fts5(
    text, id UNINDEXED, path UNINDEXED, source UNINDEXED, model UNINDEXED,
    start_line UNINDEXED, end_line UNINDEXED, columnsize=0
  );`);
const shadow = () => db.prepare("SELECT name FROM sqlite_schema WHERE name = 'memory_index_chunks_fts_docsize'").all().length;
console.log(JSON.stringify({ step: "before admission", docsizeTables: shadow() }));
for (const sql of ["SELECT COUNT(*) AS n FROM memory_index_chunks_fts", "SELECT COUNT(*) AS n FROM memory_index_chunks_fts_docsize"]) {
  try { console.log(JSON.stringify({ sql, result: db.prepare(sql).get() })); } catch (e) { console.log(JSON.stringify({ sql, error: e.message })); }
}
const r = storage.ensureMemoryIndexSchema({ db, cacheEnabled: false, ftsEnabled: true });
console.log(JSON.stringify({ step: "after admission", result: r, docsizeTables: shadow(),
  ddlHasColumnsize: /columnsize/.test(db.prepare("SELECT sql FROM sqlite_schema WHERE name = 'memory_index_chunks_fts'").get().sql),
  ftsRows: db.prepare("SELECT COUNT(*) AS n FROM memory_index_chunks_fts").get().n,
  docsizeRows: db.prepare("SELECT COUNT(*) AS n FROM memory_index_chunks_fts_docsize").get().n }));
db.close();
