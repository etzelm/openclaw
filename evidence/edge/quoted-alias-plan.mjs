// Scratch, in-memory: how SQLite plans the AFTER count statement for a quoted custom FTS name.
import { DatabaseSync } from "node:sqlite";
const db = new DatabaseSync(":memory:");
db.exec(`CREATE VIRTUAL TABLE "custom fts" USING fts5(text)`);
db.exec(`INSERT INTO "custom fts"(text) VALUES ('a'), ('b')`);
for (const sql of [`SELECT COUNT(*) AS n FROM "custom fts"`, `SELECT COUNT(*) AS n FROM "custom fts"_docsize`, `SELECT COUNT(*) AS n FROM custom_bare_docsize`]) {
  try {
    const plan = db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all().map((r) => r.detail).join(" | ");
    console.log(JSON.stringify({ sql, plan, result: db.prepare(sql).get() }));
  } catch (e) {
    console.log(JSON.stringify({ sql, error: e.message }));
  }
}
