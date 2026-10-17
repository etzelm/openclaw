# Parameters and derivations (t1-01 search prepare, production-function measurement)

## Function under test
Built `searchKeywordWithFallback`, resolved per arm by grep of `dist/*.mjs` for `function searchKeywordWithFallback`
and the chunk's `export { searchKeywordWithFallback as a, ... }`:
- BEFORE: `<home>/work/t1-01-search-prepare-main/dist/manager-status-state-BrlNrGUe.mjs`
- AFTER:  `<home>/work/t1-01-search-prepare/dist/manager-status-state-BBw_5o57.mjs`
Called as the worker does: `searchKeywordWithFallback({ ...request.query, db })`
(extensions/memory-core/src/memory/manager-search.worker.ts:139, in `executeMemorySearchWorkerQuery`).
See `dist-diff.out` for the built-code diff (only the registration code, `LIMIT +?` and `LIKE (? || '')`).

## request.query derivation (from the manager's keyword request)
Built by `buildKeywordSearchQuery`, extensions/memory-core/src/memory/manager-keyword-retrieval.ts:267-296 (the lines
`body: {...}` and `path: {...}`), mirrored in `lib.mjs buildKeywordRequest`:
- ftsTable = `memory_index_chunks_fts` (MEMORY_INDEX_FTS_TABLE, src/infra/database-engine/sqlite-search-schema.ts:14, imported as FTS_TABLE at manager-keyword-retrieval.ts:7)
- pathFtsTable = `memory_index_paths_fts` (MEMORY_INDEX_PATHS_FTS_TABLE, sqlite-search-schema.ts:15, imported as PATH_FTS_TABLE at manager-keyword-retrieval.ts:8)
- limit = 24: `Math.min(200, Math.max(1, Math.floor(maxResults * candidateMultiplier)))`
  (manager-search-orchestration.ts:135-138) with maxResults 6 (DEFAULT_MAX_RESULTS, src/agents/memory-search.ts:63) and
  hybrid.candidateMultiplier 4 (memory-search.ts:125)
- exactPathLimit = 200 (EXACT_PATH_CANDIDATE_LIMIT, manager-keyword-retrieval.ts:31)
- snippetMaxChars = 700 (SNIPPET_MAX_CHARS, manager-keyword-retrieval.ts:30)
- sourceFilter, default sources: `["memory"]` (DEFAULT_SOURCES, src/agents/memory-search-source-policy.ts:3; used by normalizeSources);
  SQL ` AND source IN (?)` for the body table and ` AND memory_index_paths_fts.source IN (?)` for the path table
  (buildMemorySourceFilter, extensions/memory-core/src/memory/source-filter.ts)
- ftsTokenizer = `unicode61` (default, src/agents/memory-search.ts:201). The FTS DDL of both real stores has no
  tokenize clause, so unicode61 default. Synthetic stores use `unicode61` and `trigram` explicitly.
- boostFallbackRanking = true (keywordOptions, manager-search-orchestration.ts:143)
- includeRecallMetadata false/undefined for the memory-only source list (fuseRecallMetadata requires sessions-only).

## Connection
`retainOpenClawAgentDatabaseReadOnly` / the built `openOpenClawAgentDatabaseReadOnly` REFUSE both copies:
`SqliteSchemaMismatchError ... uses schema version 24; stop active agents and run openclaw doctor --fix to migrate
session identities before using it` (probe: `probe-open.mjs`, run on the AFTER tree; opener
`openclaw-agent-db-readonly-open-De_YQ_Mf.mjs`). So both arms use the same fallback:
1. `openSqliteReadOnlyDatabase(copyPath, { timeout: 5000 })` from the arm's own built
   `sqlite-snapshot-source-Cqnw_hx4.mjs` (same lower layer the agent read-only opener calls:
   openNodeSqliteDatabase with `readOnly: true`, so the repo's schema tracking and reader registration are active), then
2. the arm's built `enableNodeSqliteKyselyStatementCache(db)` from `kysely-sync-cache-state-CKvZWeYI.mjs` (the same call
   openOpenClawAgentDatabaseReadOnly makes, openclaw-agent-db-readonly-open-B6j_Yaue.mjs), so the bounded statement
   cache (64 entries, second-use admission) behaves as in production.
The ownership and schema-version checks of the agent opener are skipped; nothing else differs. Each arm works on its
own `cp` of the snapshot under `<scratch>/prod/stores/` (deleted at the end). Stores are never written.
Actual method string is recorded in every raw result (`connectionMethod`).

## Inputs (same 20 in both arms)
q01-q08 are the fixed words, in order: memory, project, notes, config, agent, session, update, error.
q09-q20 are 12 basename stems (lowercase, `^[a-z0-9_-]{3,}$`) taken from `memory_index_sources` rows with
source = 'memory', sorted, de-duplicated, picked at evenly spaced indexes (`floor(i * n / 12)`); never published.
Synthetic stores use an explicit list (synthetic-queries.json, publishable, includes non-ASCII and NFD forms).

## Timing protocol
Warm, same process: open, 2 warm-up passes over the 20 inputs, then 5 reps; each rep runs N searches cycling the
20 inputs (N = 400 dev and synthetic, 200 main), mean microseconds per search from process.hrtime over the rep.
Fresh node process per run; 4 runs per store ordered BEFORE, AFTER, AFTER, BEFORE (round 1 = runs 1-2, round 2 = runs 3-4).
Before each run `uptime` is recorded in `raw/timing-<store>.log`; if load1 > 8 the driver waited in 60 s steps, up to
1200 s, then proceeded (waits recorded in the timing files). Stores: dev and main are real private snapshots (schema 24).

## Compile counting
Authorizer installed with `DatabaseSync.prototype.setAuthorizer.call(db, cb)` (returns SQLITE_OK) before the first
search, which bypasses the repo's instance setAuthorizer wrapper (that would drop the statement cache and set the
authorizer-active flag). Count per search: SQLITE_READ callbacks on memory_index_chunks (C), db.prepare calls (P) and
db.function registrations (F) via instance wrappers. C counts callbacks, so one statement compile contributes several
(the four search statements read memory_index_chunks 43 times in total per full compile).

## Plans
Each executed statement (all/get/iterate/run wrapped on statements returned by the instance prepare) is captured with
its parameters; `EXPLAIN QUERY PLAN <sql>` then runs on the same connection with the same parameters, via the original
prepare (not recorded). Shapes are matched BEFORE vs AFTER by position and by SQL normalized for `LIMIT +?` and `(? || '')`.
