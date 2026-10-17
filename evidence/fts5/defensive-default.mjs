// Scratch :memory: only. Default node:sqlite connection (no enableDefensive call): is a write to an
// FTS5 shadow table refused, and does a COUNT(*) read work with and without trusted_schema=OFF?
import { DatabaseSync } from "node:sqlite";
const db = new DatabaseSync(":memory:");
console.log(`# node ${process.version}, node:sqlite SQLite ${db.prepare("select sqlite_version() v").get().v}`);
db.exec("CREATE VIRTUAL TABLE f USING fts5(text, id UNINDEXED)");
db.exec("INSERT INTO f(rowid, text, id) VALUES (1, 'a', 'x'), (2, 'b', 'y')");
console.log("default connection read f_docsize:", JSON.stringify(db.prepare("SELECT COUNT(*) AS n FROM f_docsize").get()));
try {
  db.exec("DELETE FROM f_docsize");
  console.log("default connection write to f_docsize: allowed");
} catch (e) {
  console.log("default connection write to f_docsize refused:", e.message);
}
db.exec("PRAGMA trusted_schema = OFF; PRAGMA query_only = ON;");
console.log("trusted_schema=OFF + query_only=ON read f_docsize:", JSON.stringify(db.prepare("SELECT COUNT(*) AS n FROM f_docsize").get()));
