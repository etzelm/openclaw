// Control: an FTS5 query ordered by rank, with NO bound parameters, still triggers
// authorizer callbacks on every run after the first, because FTS5 prepares its own
// sorter statement per query (fts5_main.c, "SELECT rowid, rank FROM %Q.%Q ORDER BY ...").
// This is the 5-callback residual seen per search in both arms.
import { DatabaseSync, constants } from "node:sqlite";
const db = new DatabaseSync(":memory:");
db.exec("CREATE VIRTUAL TABLE t USING fts5(text, id UNINDEXED)");
const ins = db.prepare("INSERT INTO t(text, id) VALUES (?, ?)");
for (let i = 0; i < 50; i += 1) ins.run(`alpha beta ${i % 7 === 0 ? "gamma" : "delta"} ${i}`, `id${i}`);
const names = Object.fromEntries(Object.entries(constants).filter(([k]) => k.startsWith("SQLITE_") && !k.startsWith("SQLITE_CHANGESET")).map(([k, v]) => [v, k.replace("SQLITE_", "")]));
let seen = [];
DatabaseSync.prototype.setAuthorizer.call(db, (code, a, b) => { seen.push(`${names[code] ?? code}${code === constants.SQLITE_READ ? ":" + a : ""}`); return constants.SQLITE_OK; });
const cases = {
  "MATCH literal, rank MATCH 'bm25()', ORDER BY rank, LIMIT literal (no params)": ["SELECT id, rank FROM t WHERE t MATCH 'gamma' AND rank MATCH 'bm25()' ORDER BY rank LIMIT 5", []],
  "MATCH ?, ORDER BY rank, LIMIT +?": ["SELECT id, rank FROM t WHERE t MATCH ? AND rank MATCH 'bm25()' ORDER BY rank LIMIT +?", ["gamma", 5]],
  "MATCH ?, ORDER BY rank, LIMIT ?": ["SELECT id, rank FROM t WHERE t MATCH ? AND rank MATCH 'bm25()' ORDER BY rank LIMIT ?", ["gamma", 5]],
  "MATCH ?, no ORDER BY, LIMIT +?": ["SELECT id FROM t WHERE t MATCH ? LIMIT +?", ["gamma", 5]],
};
console.log(`node ${process.version} sqlite ${process.versions.sqlite}`);
for (const [label, [sql, params]] of Object.entries(cases)) {
  const stmt = db.prepare(sql);
  const runs = [];
  for (let r = 0; r < 3; r += 1) { seen = []; const rows = stmt.all(...params); const c = {}; for (const s of seen) c[s] = (c[s] ?? 0) + 1; runs.push(`run ${r + 1}: rows=${rows.length} callbacks=${seen.length} ${JSON.stringify(c)}`); }
  console.log(`${label}\n  ${runs.join("\n  ")}`);
}
