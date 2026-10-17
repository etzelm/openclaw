// Scratch, in-memory: does a quoted custom ftsTable admit on this build, and does a
// custom bare name? Prints ftsAvailable and ftsError text for each.
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";
const tree = process.argv[2];
const storage = await import(pathToFileURL(`${tree}/dist/plugin-sdk/memory-core-host-engine-storage.js`).href);
for (const ftsTable of ['custom_fts', '"custom fts"', '"customquoted"', 'main.custom_qualified']) {
  const db = new DatabaseSync(":memory:");
  try {
    storage.ensureMemoryIndexSchema({ db, cacheEnabled: false, ftsEnabled: false });
    db.exec(`INSERT INTO memory_index_chunks (id, path, source, start_line, end_line, hash, model, text, embedding, updated_at) VALUES ('a', 'memory/a.md', 'memory', 1, 1, 'h', 'm', 'alpha body', X'', 1)`);
    const r1 = storage.ensureMemoryIndexSchema({ db, cacheEnabled: false, ftsEnabled: true, ftsTable });
    const r2 = storage.ensureMemoryIndexSchema({ db, cacheEnabled: false, ftsEnabled: true, ftsTable });
    console.log(JSON.stringify({ ftsTable, first: r1, second: r2 }));
  } catch (e) {
    console.log(JSON.stringify({ ftsTable, threw: String(e?.message ?? e) }));
  } finally {
    db.close();
  }
}
