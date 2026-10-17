// Shared helpers for measure-search.mjs and the synthetic generator.
import { DatabaseSync } from "node:sqlite";
import { resolveExport } from "./resolve-dist.mjs";

export const WORDS = ["memory", "project", "notes", "config", "agent", "session", "update", "error"];

// Open the copy the way a retained production reader would, minus agent ownership checks
// (those refuse schema 24). Method 1: the arm's built low-level read-only opener
// (openSqliteReadOnlyDatabase -> openNodeSqliteDatabase, same function the agent reader uses).
// Method 2 (fallback): plain DatabaseSync readOnly. Then enable the arm's built statement cache.
export async function openConn(armRoot, storePath) {
  const cacheFn = await resolveExport(armRoot, "enableNodeSqliteKyselyStatementCache");
  let db;
  let method;
  try {
    const opener = await resolveExport(armRoot, "openSqliteReadOnlyDatabase");
    db = opener.fn(storePath, { timeout: 5000 });
    method = `built openSqliteReadOnlyDatabase (${opener.file}) + built enableNodeSqliteKyselyStatementCache (${cacheFn.file})`;
  } catch (e) {
    db = new DatabaseSync(storePath, { readOnly: true });
    method = `DatabaseSync readOnly fallback (${e.name}) + built enableNodeSqliteKyselyStatementCache (${cacheFn.file})`;
  }
  cacheFn.fn(db);
  return { db, method };
}

export function sourceFilter(alias, sources) {
  // Mirrors extensions/memory-core/src/memory/source-filter.ts buildMemorySourceFilter.
  const column = alias ? `${alias}.source` : "source";
  return { sql: ` AND ${column} IN (${sources.map(() => "?").join(", ")})`, params: [...sources] };
}

// Mirrors MemoryKeywordWorkerQuery built by manager-keyword-retrieval.ts buildKeywordSearchQuery.
export function buildKeywordRequest(query, tokenizer) {
  const sources = ["memory"];
  const limit = 24; // min(200, floor(maxResults 6 * candidateMultiplier 4))
  return {
    body: {
      ftsTable: "memory_index_chunks_fts",
      query,
      ftsTokenizer: tokenizer,
      limit,
      snippetMaxChars: 700,
      sourceFilter: sourceFilter(undefined, sources),
      boostFallbackRanking: true,
    },
    path: {
      pathFtsTable: "memory_index_paths_fts",
      query,
      exactPathLimit: 200,
      ftsTokenizer: tokenizer,
      limit,
      snippetMaxChars: 700,
      sourceFilter: sourceFilter("memory_index_paths_fts", sources),
    },
  };
}

// 8 fixed words + 12 deterministic basename stems from memory_index_sources (source = memory).
export function realQueries(storePath) {
  const db = new DatabaseSync(storePath, { readOnly: true });
  const rows = db.prepare("SELECT path FROM memory_index_sources WHERE source = 'memory' ORDER BY path").all();
  db.close();
  const stems = [
    ...new Set(
      rows
        .map((r) => {
          const base = r.path.split("/").at(-1);
          const i = base.lastIndexOf(".");
          return (i > 0 ? base.slice(0, i) : base).toLowerCase();
        })
        .filter((s) => /^[a-z0-9_-]{3,}$/.test(s)),
    ),
  ].sort();
  const picked = [];
  for (let i = 0; i < 12 && stems.length > 0; i++) picked.push(stems[Math.floor((i * stems.length) / 12)]);
  return { queries: [...WORDS, ...picked], stemPool: stems.length };
}

export const label = (i) => `q${String(i + 1).padStart(2, "0")}`;
