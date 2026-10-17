// Recompute the keyword baseline hashes pinned in manager-search-worker.sqlite.test.ts
// from each arm's BUILT search code, and show the AFTER SQL equals the BEFORE SQL with
// only `LIMIT ?` -> `LIMIT +?` and `LIKE ? ESCAPE` -> `LIKE (? || '') ESCAPE` applied.
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { resolveExport } from "./resolve-dist.mjs";
const sha = (s) => createHash("sha256").update(s).digest("hex");
const keywordQuery = {
  body: { ftsTable: "memory_index_chunks_fts", query: "cafe", ftsTokenizer: "unicode61", limit: 2, snippetMaxChars: 80, sourceFilter: { sql: " AND source IN (?)", params: ["memory"] } },
  path: { pathFtsTable: "memory_index_paths_fts", query: "cafe", ftsTokenizer: "unicode61", exactPathLimit: 2, limit: 2, snippetMaxChars: 80, sourceFilter: { sql: " AND memory_index_paths_fts.source IN (?)", params: ["memory"] } },
};
async function capture(arm) {
  const ensure = await resolveExport(arm, "ensureMemoryIndexSchema");
  const search = await resolveExport(arm, "searchKeywordWithFallback");
  const db = new DatabaseSync(":memory:");
  ensure.fn({ db, cacheEnabled: false, ftsEnabled: true });
  const sql = [];
  const prepare = db.prepare.bind(db);
  db.prepare = (s, ...r) => { sql.push(s); return prepare(s, ...r); };
  const result = await search.fn({ ...keywordQuery, db });
  db.close();
  return { sql, result: sha(JSON.stringify(result)), files: [ensure.file, search.file] };
}
const [before, after] = [await capture(process.argv[2]), await capture(process.argv[3])];
const rewrite = (s) => s.replaceAll("LIMIT ?", "LIMIT +?").replaceAll("LIKE ? ESCAPE", "LIKE (? || '') ESCAPE");
console.log("BEFORE dist", before.files.join(", "));
console.log("AFTER dist", after.files.join(", "));
for (let i = 0; i < Math.max(before.sql.length, after.sql.length); i += 1) {
  const b = before.sql[i] ?? "", a = after.sql[i] ?? "";
  console.log(`statement ${i + 1}: before ${sha(b)} | rewrite(before) ${sha(rewrite(b))} | after ${sha(a)} | rewrite(before) === after: ${rewrite(b) === a} | LIMIT ? ${(b.match(/LIMIT \?/g) ?? []).length} -> ${(a.match(/LIMIT \?/g) ?? []).length}, LIKE ? ${(b.match(/LIKE \?/g) ?? []).length} -> ${(a.match(/LIKE \?/g) ?? []).length}`);
}
console.log(`statements ${before.sql.length} -> ${after.sql.length}; empty-store result hash before ${before.result} after ${after.result}`);
