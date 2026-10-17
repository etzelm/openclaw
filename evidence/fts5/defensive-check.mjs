// Scratch in-memory DB only. Checks that the _docsize count equals the FTS5 count under the
// admitted DDL (including after deletes, an update, and an empty-text row), and that a read of the
// shadow table is allowed with SQLITE_DBCONFIG_DEFENSIVE on, while a write is refused.
import { DatabaseSync } from "node:sqlite";
const db = new DatabaseSync(":memory:");
console.log(`# node ${process.version}, node:sqlite SQLite ${db.prepare("select sqlite_version() v").get().v}`);
for (const tokenize of ["", ", tokenize='trigram case_sensitive 0'"]) {
  db.exec("DROP TABLE IF EXISTS f");
  db.exec(`CREATE VIRTUAL TABLE f USING fts5(text, id UNINDEXED, path UNINDEXED, source UNINDEXED, model UNINDEXED, start_line UNINDEXED, end_line UNINDEXED${tokenize})`);
  const ins = db.prepare("INSERT INTO f(rowid, text, id, path, source, model, start_line, end_line) VALUES (?, ?, 'i', 'p', 's', 'm', 1, 2)");
  for (let i = 1; i <= 1000; i++) ins.run(i, i % 50 === 0 ? "" : `alpha beta ${i}`);
  db.exec("DELETE FROM f WHERE rowid % 7 = 0");
  db.exec("UPDATE f SET text = 'gamma' WHERE rowid = 3");
  const counts = () => db.prepare("SELECT (SELECT COUNT(*) FROM f) AS fts, (SELECT COUNT(*) FROM f_docsize) AS docsize, (SELECT COUNT(*) FROM f_content) AS content").get();
  console.log(`tokenizer=${tokenize ? "trigram" : "unicode61"} after inserts/deletes/update:`, JSON.stringify(counts()));
  db.exec("DELETE FROM f; INSERT INTO f(rowid, text, id, path, source, model, start_line, end_line) VALUES (10, 'x', 'i', 'p', 's', 'm', 1, 2)");
  console.log(`tokenizer=${tokenize ? "trigram" : "unicode61"} after delete-all + 1 insert:`, JSON.stringify(counts()));
}
let defensiveSupported = true;
try {
  db.enableDefensive?.(true);
  if (typeof db.enableDefensive !== "function") defensiveSupported = false;
} catch (e) {
  defensiveSupported = false;
  console.log("enableDefensive threw:", e.message);
}
console.log("enableDefensive available:", defensiveSupported);
if (defensiveSupported) {
  console.log("defensive read of f_docsize:", JSON.stringify(db.prepare("SELECT COUNT(*) AS n FROM f_docsize").get()));
  try {
    db.exec("DELETE FROM f_docsize");
    console.log("defensive write to f_docsize: allowed");
  } catch (e) {
    console.log("defensive write to f_docsize refused:", e.message);
  }
}
