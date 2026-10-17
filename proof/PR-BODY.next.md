Related: #144641, #174438

## What Problem This Solves

Every memory schema admission runs the FTS row-count check `SELECT COUNT(*) FROM memory_index_chunks_fts` in `reconcileMemoryChunkFtsRows`. Admission runs when a writable memory manager opens its published database, on each later admission call in the same process, and in Doctor's legacy sidecar migration. FTS5 serves that count as a full scan of the `%_content` shadow table, which holds every stored column of every chunk (`text` plus six UNINDEXED columns), only to count rows. On the Gateway paths the scan runs inside the agent database's write transaction (`BEGIN IMMEDIATE`), so it is time the write lock is held.

On two real stores, the scan reads this much just to produce a number:

| Store | Chunks | File size | `%_content` | `%_docsize` |
|---|---|---|---|---|
| dev | 6,012 | 430,518,272 bytes | 9,265,152 bytes (2,262 pages) | 110,592 bytes (27 pages) |
| main | 43,490 | 4,855,853,056 bytes | 84,242,432 bytes (20,567 pages) | 864,256 bytes (211 pages) |

Page size is 4096 on both. On the main store the count statement alone takes about 25 ms with a warm cache and 1.7 to 1.8 s with a cold one, out of a whole first admission of 75.6 to 78.0 ms warm and 2,003.4 to 2,059.5 ms cold.

## User Impact

User impact: opening a memory store with a large full-text index admits faster and holds the agent database's write lock for less time, with identical search results.

| Store | Path | Before | After |
|---|---|---|---|
| main (43,490 chunks) | first admission, warm | 75.6 to 78.0 ms | 52.1 to 52.3 ms |
| main | first admission, cold | 2,003.4 to 2,059.5 ms | 316.7 to 325.2 ms |
| main | already admitted, warm (noisier, see Gaps) | 52.3 to 52.4 ms | 24.7 to 29.9 ms |
| dev (6,012 chunks) | first admission, warm | 32.4 to 32.5 ms | 29.4 to 30.2 ms |
| dev | first admission, cold | 220.2 to 229.7 ms | 71.6 to 72.1 ms |
| dev | already admitted, warm (noisier, see Gaps) | 6.6 to 9.9 ms | 3.0 to 3.1 ms |

Figures are medians per round across the two measured rounds, whole schema admission. On a clean restart the memory schema receipt is reused (docs/reference/database-schemas/integrity-and-recovery.md, Integrity checks), so the already-admitted rows are the common path; the first-admission rows apply after an unclean shutdown, changed memory settings, or a missing seal. Both paths run the same single count statement. The already-admitted rows are measured warm only; by inference from the cold count-statement rows (1,727.1 and 1,780.4 ms to 56.5 and 59.5 ms on the main store), a cold already-admitted run would gain about the same amount, which was not measured.

The removed cost grew roughly in proportion to chunk count across these two stores: the small store gains little when warm (about 32 ms to about 30 ms) and more when its pages are not cached.

Nothing an operator configures, searches, or stores changes, and search results are the same. The gain is admission time and write-lock hold. No config keys, defaults, schema, stored bytes, migration, retention, or permissions change, so the storage-changes review checkpoint is not triggered.

## Why This Change Was Made

The count is the only expensive part of the check. Under the admitted DDL (`buildTextSchema` in `sqlite-memory-search-fragments.ts` sets no `columnsize`, `content`, or `detail` option), FTS5 keeps one `%_docsize` row per document, so `COUNT(*)` of `memory_index_chunks_fts_docsize` is the same number from a much smaller table (on the main store 211 pages instead of 20,567). Admission drops and recreates any FTS table whose stored DDL does not match the fragment (`dropMismatchedFtsTable`) before the count runs, so an admitted body FTS table always has the `%_docsize` table. The reconcile's decision (`force || canonical_count !== derived_count`) and its repair from #144641 are kept as they are.

The count now reads `memory_index_chunks_fts_docsize`. FTS5 documents that table by name and purpose (section 4.5: `<name>_docsize`, one size record per row, omitted only when `columnsize=0`), and the admitted DDL sets no `columnsize` option. In SQLite 3.53.0, `fts5_storage.c` writes the record with `INSERT OR REPLACE` keyed by rowid for every inserted or rebuilt row and deletes it with the row, all gated on that option. FTS5 section 9 lists shadow tables as not meant for direct user access; this is the first place OpenClaw reads rows of one, and the access is a read-only count. A default `node:sqlite` connection refuses writes to the table and allows the read, including with `PRAGMA trusted_schema = OFF` and `query_only = ON`, and admission already fingerprints these shadow tables in its catalog check (`memory_index_chunks_fts_docsize` is in the generated memory catalog). A two-line comment at the statement records the `columnsize=1` assumption. If the admitted DDL stopped producing `%_docsize`, the new test and the existing `ftsAvailable` assertions fail.

Alternatives:
- A trigger-maintained counter drifts with the same triggers the check exists to verify.
- A `MATCH` count counts only rows that match, not all rows.
- Reading the FTS5 averages record decodes an internal binary format.
- Moving the count outside `BEGIN IMMEDIATE` breaks the atomicity of the check and the rebuild.

## The change in one sentence

Count the `%_docsize` shadow table instead of the FTS5 virtual table in the reconcile's `derived_count`, with a two-line comment saying why that returns the same number.

Diff: 2 files, 58 insertions, 2 deletions. Production: `src/infra/database-engine/sqlite-search-schema.ts` (+3/-1). Test: `packages/memory-host-sdk/src/host/memory-schema-fts-reconcile.test.ts` (+55/-1, the -1 is the vitest import gaining `vi`).

| Input case | Expected outcome |
|---|---|
| Counts equal (canonical rows = FTS rows) | No rebuild, as before |
| FTS rows missing (counts diverge) | Rebuild, as before |
| `force` from a trigger-body mismatch on first admission | Rebuild regardless of the counts, as before |
| Freshly created FTS table | Empty `%_docsize`, so 0, the same as `COUNT(*)` of the empty FTS table |
| Mismatched FTS DDL, including contentless or indexed-metadata tables | Dropped and recreated before the count (existing tests "repairs body indexes with contentless storage" and "repairs body indexes with indexed metadata columns" cover both), so the count always sees a table that has `%_docsize` |
| Existing body FTS table created with `columnsize=0` (no `%_docsize`) | Not reachable by the count: admission drops and recreates it first. Run through admission on both builds: `ftsAvailable: true`, recreated DDL without `columnsize`, 1 FTS row and 1 docsize row. Called directly on such a table, `COUNT(*)` of `memory_index_chunks_fts_docsize` fails with `no such table: memory_index_chunks_fts_docsize` |
| Custom deprecated `ftsTable`, bare or schema-qualified | Passes the same fragment check; `${ftsTable}_docsize` names its docsize table. Admission returns `ftsAvailable: true` on both builds for `custom_fts` and `main.custom_qualified` |
| Custom deprecated `ftsTable`, quoted (for example `"custom fts"`) | SQLite parses `"custom fts"_docsize` as the FTS table with the alias `_docsize`, so the count keeps the full scan and returns the same number as before (plan `SCAN _docsize VIRTUAL TABLE INDEX 0:`, 2 = 2 on a scratch table). Admission returns `ftsAvailable: true` on both builds |
| PostgreSQL | Not on this path |

Unchanged: the comparison, the `force` argument, `rebuildMemoryChunkFts` SQL, the transaction (`BEGIN IMMEDIATE` on the admitted path, the `ensure_memory_search` savepoint on first admission), the error handling around admission, and the statement count per admission (one).

## Evidence

All of the following ran on one machine (Mac Studio, Mac15,14, macOS 27.0.1) against base `d4d2c3dd1e3` and this branch's tree (the measured AFTER build differs from the commit under review only in the test file, see tree identity in the evidence); the benchmark and scratch checks ran under Node v24.21.0 with SQLite 3.53.4 from `node:sqlite`.

### Method

BEFORE and AFTER are separate clean checkouts and builds of the base and of this branch; their production source differs only by this diff. The harness drives the built production functions (`openNodeSqliteDatabase`, `configureMemorySqliteWalMaintenance` with busy timeout 5000, `setSqliteBusyTimeout`, `runSqliteImmediateTransactionSync`, `ensureMemoryIndexSchema`, `admitSqliteSchema`) in the order of the publication worker's `schema.admit` handler: foreign keys off, busy timeout 0, `BEGIN IMMEDIATE`, `ensureMemoryIndexSchema`, `COMMIT`, `admitSqliteSchema`. Production calls it with `ftsEnabled` from `query.hybrid.enabled` (default true), `ftsTokenizer` from `store.fts.tokenizer` (default `unicode61`), and `cacheEnabled` (default true), which is the triple used here.

Warm and cold rows measure one admission per fresh node process (admission receipts are in-process memory, so every run takes the first-admission path and logs `path=first-admission`). Warm rounds run 2 warmups, then 5 measured runs per arm; cold rounds run 5 measured runs per arm, each on its own fresh copy, with no warmup. Already-admitted rows measure the second call in a process, after 2 warmups. Arms are interleaved over two rounds; figures are medians of the 5. "Cold" means the run reads a fresh copy of the store written with `F_NOCACHE`. Purging the OS cache needs root, so the copy was validated instead: 20000 random 4 KiB reads on a fresh `F_NOCACHE` copy cost 268.0 us per read on the first pass against 2.7 us when repeated (sequential read throughput could not tell cold from warm on this SSD).

The stores are `sqlite3 .backup` snapshots of two real agent databases (430,518,272 and 4,855,853,056 bytes), copied to local disk with the sha256 verified equal. Script and raw outputs: https://github.com/etzelm/openclaw/tree/assets/t1-02-fts-count-evidence (scripts `measure-admission.mjs`, `measure-rounds.mjs`, `admitted-rounds.mjs`, `cold-copy.py`; outputs under `evidence/`, including the base-checkout runs of the two failing checks in `gates/base-checks.out` and the edge-case scratch runs under `evidence/edge/`).

### Build

`pnpm build` succeeded for both arms:

```
[build-all] phase timings: total 6m 35.7s; slowest write-unified-entry-dts 3m 18.5s; tsdown 44.1s; runtime-postbuild 29.7s; ui:build 25.9s; tsdown-packages 24.9s; write-cli-startup-metadata 14.1s; external-plugins:local-dist 14s; check-cli-bootstrap-imports 13.9s; plugins:assets:copy 10.7s; tsdown-ai 7.77s; plugins:assets:build 5.72s; check-plugin-sdk-exports 2.59s; build-stamp 497ms; write-build-info 195ms; runtime-postbuild-stamp 130ms; native-protocol 120ms
[build-all] phase timings: total 6m 12.6s; slowest write-unified-entry-dts 3m 1.8s; tsdown 39.9s; runtime-postbuild 30.9s; ui:build 24.7s; tsdown-packages 24.3s; external-plugins:local-dist 18.3s; check-cli-bootstrap-imports 16s; write-cli-startup-metadata 11s; plugins:assets:copy 8.38s; tsdown-ai 7.34s; plugins:assets:build 5.55s; check-plugin-sdk-exports 2.94s; runtime-postbuild-stamp 253ms; build-stamp 253ms; write-build-info 249ms; native-protocol 74ms
```

The first line is BEFORE, the second AFTER. In each built tree the changed statement appears in four files, and on the line that carries it the only difference is `_docsize`:

```
dist/search-admission-wNFq-T-l.mjs:323:         (SELECT COUNT(*) FROM ${ftsTable}) AS derived_count`).get();
dist/search-admission-DU3mLXRY.mjs:323:         (SELECT COUNT(*) FROM ${ftsTable}_docsize) AS derived_count`).get();
```

### Behaviour, case by case

The count statement is `derived_count` in `reconcileMemoryChunkFtsRows`. Query plans from the two stores (identical on both):

```
plan BEFORE (FROM memory_index_chunks_fts): id=22 parent=17 SCAN memory_index_chunks_fts VIRTUAL TABLE INDEX 0:
plan AFTER (FROM memory_index_chunks_fts_docsize): id=23 parent=17 SCAN memory_index_chunks_fts_docsize
```

Row counts agree on both stores: 6,012 canonical = 6,012 FTS = 6,012 docsize (dev) and 43,490 = 43,490 = 43,490 (main). `counts_equal=true` and `total_changes=0` in every measured run, so admission wrote nothing in either arm.

Main store (43,490 chunks), first admission, warm:

```
round 1 before: median admit_ms=78.048 raw=[75.47, 75.621, 79.094, 78.048, 78.218] | median reconcile_count_stmt_ms=25.097 raw=[24.423, 23.969, 25.784, 25.097, 25.308]
round 1 after: median admit_ms=52.26 raw=[51.685, 52.985, 52.26, 51.226, 52.677] | median reconcile_count_stmt_ms=0.479 raw=[0.471, 0.551, 0.469, 0.557, 0.479]
round 2 before: median admit_ms=75.627 raw=[77.412, 75.507, 75.592, 75.627, 76.117] | median reconcile_count_stmt_ms=24.387 raw=[25.379, 24.356, 23.792, 24.387, 24.581]
round 2 after: median admit_ms=52.073 raw=[52.073, 51.847, 52.976, 52.408, 52.068] | median reconcile_count_stmt_ms=0.517 raw=[0.526, 0.517, 0.508, 0.463, 0.519]
```

Main store, first admission, cold:

```
round 1 before: median admit_ms=2003.397 raw=[1914.892, 2003.397, 1789.526, 2843.063, 2483.232] | median reconcile_count_stmt_ms=1727.053 raw=[1635.94, 1727.053, 1505.792, 2474.106, 2195.309]
round 1 after: median admit_ms=316.736 raw=[316.182, 299.673, 316.736, 661.542, 432.43] | median reconcile_count_stmt_ms=56.469 raw=[56.469, 51.661, 56.373, 142.176, 114.43]
round 2 before: median admit_ms=2059.483 raw=[1919.738, 1958.895, 6158.192, 2059.483, 2113.376] | median reconcile_count_stmt_ms=1780.422 raw=[1635.379, 1661.141, 5639.556, 1780.422, 1828.078]
round 2 after: median admit_ms=325.249 raw=[325.249, 374.172, 339.857, 323.186, 320.642] | median reconcile_count_stmt_ms=59.525 raw=[49.352, 68.728, 98.253, 56.373, 59.525]
```

Summary of all cells (whole admission, then the count statement alone), milliseconds, round 1 / round 2:

| Store | Chunks | Measure | Warm before | Warm after | Cold before | Cold after |
|---|---|---|---|---|---|---|
| dev | 6,012 | admission | 32.5 / 32.4 | 30.2 / 29.4 | 229.7 / 220.2 | 71.6 / 72.1 |
| main | 43,490 | admission | 78.0 / 75.6 | 52.3 / 52.1 | 2003.4 / 2059.5 | 316.7 / 325.2 |
| dev | 6,012 | count statement | 2.8 / 2.8 | 0.1 / 0.1 | 159.6 / 152.7 | 6.1 / 5.9 |
| main | 43,490 | count statement | 25.1 / 24.4 | 0.5 / 0.5 | 1727.1 / 1780.4 | 56.5 / 59.5 |

Already-admitted path (the second `ensureMemoryIndexSchema` call in the same process, which takes the admitted branch and runs the same single count statement), medians per round, milliseconds, round 1 / round 2:

| Store | Admission before | Admission after | Count statement before | Count statement after |
|---|---|---|---|---|
| main | 52.414 / 52.31 | 29.851 / 24.696 | 25.906 / 25.077 | 0.488 / 0.423 |
| dev | 6.563 / 9.918 | 3.046 / 3.115 | 3.014 / 2.98 | 0.007 / 0.008 |

Other FTS5 facts. From the SQLite 3.53.0 source: `fts5StorageInsertDocsize` (`INSERT OR REPLACE INTO %_docsize(id, sz)`, a no-op only when `columnsize=0`) is called for every row at `fts5_storage.c:900` (rebuild) and `:1097` (insert), and the delete path removes the record at `:772-778` under the same option; a plain `COUNT(*)` plans as `FTS5_PLAN_SCAN` ("No usable constraint"), the full scan seen above. On scratch in-memory tables, FTS, docsize and content counts agree (858 = 858 = 858) after inserts, deletes, an update, and empty-text rows, with both the `unicode61` and `trigram` tokenizers. A default `node:sqlite` connection refuses writes to the docsize table (`table f_docsize may not be modified`) and allows the read, including with `PRAGMA trusted_schema = OFF` and `query_only = ON`.

### Tests

`pnpm test packages/memory-host-sdk/src/host/memory-schema-fts-reconcile.test.ts`:

```
 Test Files  1 passed (1)
      Tests  16 passed (16)
   Duration  4.33s (transform 92%, worker 3%, tests 3%, setup 2%)
[test] passed 1 Vitest shard in 6.11s
```

Owning directory, `pnpm test src/infra/database-engine`, three shards:

```
 Test Files  9 passed | 1 skipped (10)
      Tests  49 passed | 1 skipped (50)
 Test Files  1 passed (1)
      Tests  6 passed (6)
 Test Files  14 passed | 23 skipped (37)
      Tests  62 passed | 152 skipped (214)
[test] passed 3 Vitest shards in 20.97s
```

The host directory of the memory SDK, `pnpm test packages/memory-host-sdk/src/host`, four shards (127, 89, 240, and 49 tests, 505 in total):

```
      Tests  127 passed (127)
      Tests  89 passed (89)
      Tests  240 passed (240)
      Tests  49 passed (49)
[test] passed 4 Vitest shards in 36.26s
```

The 15 memory-core test files that exercise schema admission (selected by `ensureMemoryIndexSchema|admitSqliteMemoryTextSearch|reconcileMemoryChunkFtsRows|schema\.admit`):

```
 Test Files  15 passed (15)
      Tests  197 passed (197)
[test] passed 1 Vitest shard in 23.63s
```

### Regression proof (red/green)

The new test seeds a store with 40 chunks (every tenth with empty text), deletes every third, re-inserts three, and edits one row, so `%_docsize` has moved through deletes and re-inserts. It spies `db.prepare` during a real `ensureMemoryIndexSchema` call, takes the reconcile's own count statement (the one containing `derived_count`), and asserts that:
- its `EXPLAIN QUERY PLAN` contains no `VIRTUAL TABLE` scan and does scan `memory_index_chunks_fts_docsize`;
- running it returns `canonical_count` 29 and a `derived_count` equal to `COUNT(*)` of the FTS table, which is also 29.

This guards the access path and the equality of the number. It does not prove the speedup, which the benchmark above shows. On unchanged base with only the test added, it fails on the original behaviour:

```
 ×  unit  packages/memory-host-sdk/src/host/memory-schema-fts-reconcile.test.ts > memory FTS schema reconciliation > counts derived rows from the FTS5 docsize table, not by scanning the FTS table 11ms
   → expected [ Array(1) ] to deeply equal []

 FAIL   unit  packages/memory-host-sdk/src/host/memory-schema-fts-reconcile.test.ts > memory FTS schema reconciliation > counts derived rows from the FTS5 docsize table, not by scanning the FTS table
AssertionError: expected [ Array(1) ] to deeply equal []

- Expected
+ Received

- []
+ [
+   "SCAN memory_index_chunks_fts VIRTUAL TABLE INDEX 0:",
+ ]

 Test Files  1 failed (1)
      Tests  1 failed | 15 passed (16)
```

On this branch it passes:

```
 Test Files  1 passed (1)
      Tests  16 passed (16)
```

### Other checks

`pnpm check:changed --base origin/main`, lanes `core, coreTests`:

| Check | Result |
|---|---|
| typecheck core / core tests | ok |
| lint core changed files | ok |
| format changed files | ok |
| SQLite dialect ratchet | ok (`SQLite dialect engine-maintenance (changed files): 1 -> 1.`; `SQLite dialect ratchet OK: no construct-group growth against d4d2c3dd1e3e29b7bd19914e3c9c47d40c5dde77.`) |
| SQLite worker ratchet, database-first legacy-store guard, runtime import cycles | ok |
| line-cap growth ratchet | ok (`Line-cap ratchet OK: 2 changed source files; no new violations or over-cap growth.`) |
| `git diff --check` | clean |
| max-lines suppression ratchet | failed on `ui/src/pages/chat/components/chat-message.test.tsx`, `ui/src/pages/config/config-page-state.ts`, `ui/src/pages/sessions/sessions-page-state.ts`; none are in this diff, and the same check fails on the same three files in a clean checkout of `d4d2c3dd1e3` |
| dead export scan | failed on `src/config/sessions/combined-store-paths.ts: discoveryReadOptions`, `src/shared/node-list-types.ts: NODE_APPROVAL_STATE_VALUES`, `src/state/user-profiles.types.ts: UserProfileAuthority` (production scan) and `extensions/slack/src/monitor/slash.commands.test-harness.ts: getFirstActionElementFromCommand` (full-tree scan); none are in this diff, and the same scan fails on the same exports in a clean checkout of `d4d2c3dd1e3` |

### Measured test cost

| Suite | Wall (shard) | Tests |
|---|---|---|
| `pnpm test packages/memory-host-sdk/src/host/memory-schema-fts-reconcile.test.ts` | 6.11 s (test file duration 4.33 s, 92 percent transform; the new case 8 ms) | 16 |
| same file, `pnpm test <file> -- --maxWorkers=1` | 6.18 s (test file duration 4.36 s; the new case 8 ms) | 16 |
| same file, `OPENCLAW_VITEST_MAX_WORKERS=1 pnpm test <file>` | 6.24 s (test file duration 4.42 s; the new case 8 ms) | 16 |
| `src/infra/database-engine` | 20.97 s (3 shards) | 62 passed, 152 skipped in the last shard |
| `packages/memory-host-sdk/src/host` | 36.26 s (4 shards) | 505 |
| 15 memory-core admission consumer files | 23.63 s | 197 |

All runs above had a warm compiler cache. The new case adds one in-memory database and a few dozen rows; it is the 8 ms line above. CI seconds are not available before the PR runs.

## Real behavior proof

Both builds ran through their shipped entry points, `node openclaw.mjs` from clean clones of base `d4d2c3dd1e3` and of this branch at `d27f9cb3eb7` built with `pnpm build` (`build.out`; these are separate clones from the Evidence builds, so the build times differ). Each run used its own `HOME` and `OPENCLAW_STATE_DIR`, a clean environment (`env -i`, no API keys) and `OPENCLAW_LOG_LEVEL=trace`. No outbound request was configured or made: memory used `provider: "none"` or a loopback endpoint with nothing listening. The gateway's bundled Bonjour plugin still advertised the gateway over mDNS on the local network (`gateway/<arm>/logs-gw/gateway.stdout`), which is unrelated to the changed path. Host: Mac Studio, macOS 27.0.1 arm64, Node v24.21.0, SQLite 3.53.4 from `node:sqlite` (`synthetic/env.out`). Scripts, configs and raw outputs: <PROOF-URL> (index in `README.md`).

Config: memory-core with `memory.search.provider: "none"` (keyword-only, no embedding download or network), `agents.defaults.workspace` set to the state dir's workspace, `gateway.mode: "local"`, and `logging.file` inside the run dir (`synthetic/base/openclaw.json`). With this config, `memory search` opens the agent database through `MemoryIndexManager.get`, `openPublished`, the publication worker's `schema.admit` handler and `ensureMemoryIndexSchema`, which runs `reconcileMemoryChunkFtsRows` (`dist-frames.out`). `memory status` takes a read-only open: its processes ran the statement zero times (`synthetic/notes.md`).

The code emits no log line for the reconcile, so a read-only preload (`observe-reconcile-count.mjs`, loaded with `NODE_OPTIONS=--import=...`, sha256 `6311a30b...7645` in `real/observe-final.sha256`) wraps `DatabaseSync.prototype.prepare` and writes one JSON record each time the statement containing `derived_count` runs: SQL, `EXPLAIN QUERY PLAN`, the returned counts, the statement time, and the calling function names. It changes no OpenClaw source. Wall-time runs were made without it.

### Synthetic store (publishable)

`gen-synthetic-memory.mjs` (seeded PRNG, lorem-style words) wrote 401 files, 4,651,758 bytes, manifest sha256 `1f9b7ff1...438c`, byte-identical in both arms (`synthetic/workspace-manifest.out`). `memory index --force --agent main --verbose` built the store in each arm (exit 0): 3,626 chunks = 3,626 `memory_index_chunks_fts` rows = 3,626 `memory_index_chunks_fts_docsize` rows, 401 sources, agent schema 28, and the same counts after all later runs (`synthetic/<arm>/logs/counts-b-after-index.out`, `counts-g-final.out`).

Each later step is a new process reopening that populated store. A process that finds a valid clean-close seal takes the receipt path (`reconcile` in `ensureMemoryIndexSchema`); one with the seal removed takes first admission (`admitSqliteMemoryTextSearch`). The observer recorded one statement per `memory search` process, always on a worker thread (`isMainThread: false`) inside `BEGIN IMMEDIATE` (`synthetic/observer-final-summary.md`):

| Arm | Path | Plan of the count | canonical = derived | Statement ms |
|---|---|---|---|---|
| base | receipt, 5 processes | `SCAN memory_index_chunks_fts VIRTUAL TABLE INDEX 0:` | 3626 = 3626 | 8.994 (first), then 1.736 to 1.777 |
| patched | receipt, 5 processes | `SCAN memory_index_chunks_fts_docsize` | 3626 = 3626 | 3.554 (first), then 0.039 to 0.043 |
| base | first admission, seal removed | `SCAN memory_index_chunks_fts VIRTUAL TABLE INDEX 0:` | 3626 = 3626 | 1.874 |
| patched | first admission, seal removed | `SCAN memory_index_chunks_fts_docsize` | 3626 = 3626 | 0.03 |

Patched CLI, `memory search "lorem ipsum" --json --agent main --max-results 25`, receipt path: exit 0, 25 results (`synthetic/patched/logs-final/d2-search.*`). stderr in full:

```
[plugins] loading memory-core from <scratch>/patched/dist/extensions/memory-core/cli-metadata.js
[plugins] loaded 1 plugin(s) (1 attempted) in 52.0ms
[plugins] loading memory-core from <scratch>/patched/dist/extensions/memory-core/index.js
[plugins] loaded 1 plugin(s) (1 attempted) in 127.2ms
[plugins] loading memory-core from <scratch>/patched/dist/extensions/memory-core/index.js
[plugins] loaded 1 plugin(s) (1 attempted) in 8.7ms
[state/agent-db] agent database clean-close receipt: written
```

Observer record from that process (`synthetic/patched/obs-final/d2-search.jsonl`), in full:

```
{"event":"reconcile_count","pid":8784,"threadId":5,"isMainThread":false,"inTransaction":true,"sql":"SELECT (SELECT COUNT(*) FROM memory_index_chunks) AS canonical_count, (SELECT COUNT(*) FROM memory_index_chunks_fts_docsize) AS derived_count","plan":["SCAN CONSTANT ROW","SCALAR SUBQUERY 1","SCAN memory_index_chunks USING COVERING INDEX idx_memory_index_chunks_source","SCALAR SUBQUERY 2","SCAN memory_index_chunks_fts_docsize"],"canonical_count":3626,"derived_count":3626,"stmt_ms":0.039,"callers":["callStatement (sqlite-schema-facts-Bql6amq4.mjs:199:17)","(sqlite-schema-facts-Bql6amq4.mjs:250:72)","reset (sqlite-schema-facts-Bql6amq4.mjs:243:34)","(sqlite-schema-facts-Bql6amq4.mjs:250:60)","execute (sqlite-schema-facts-Bql6amq4.mjs:224:19)","StatementSync.<anonymous> (sqlite-schema-facts-Bql6amq4.mjs:250:46)","(adapters-DqCbKFAM.mjs:132:90)","observeDatabaseOperation (adapters-DqCbKFAM.mjs:77:37)","StatementSync.value [as get] (adapters-DqCbKFAM.mjs:132:31)","reconcileMemoryChunkFtsRows (search-admission-DU3mLXRY.mjs:323:72)","reconcile (memory-schema-D98KV85k.mjs:765:5)","ensureMemoryIndexSchema (memory-schema-D98KV85k.mjs:768:33)","(manager-publication.worker-D2onu8ze.mjs:596:33)","withSqliteDatabaseWriteScope (sqlite-database-admission-Cfra70vw.mjs:537:18)","runSqliteImmediateTransactionSync.withCommit (manager-publication.worker-D2onu8ze.mjs:514:10)","runSqliteReadOperationSync (sqlite-schema-facts-Bql6amq4.mjs:701:10)","settleSqliteTransactionSync (sqlite-transaction-DNFHtRy9.mjs:287:54)","runSqliteTransactionSync (sqlite-transaction-DNFHtRy9.mjs:255:9)","(sqlite-transaction-DNFHtRy9.mjs:344:52)","withSqlitePostCommitPublications (sqlite-post-commit-B-fc95zq.mjs:138:12)","runSqliteImmediateTransactionSync (sqlite-transaction-DNFHtRy9.mjs:344:9)","(manager-publication.worker-D2onu8ze.mjs:512:82)","transact (manager-publication.worker-D2onu8ze.mjs:486:12)","write (manager-publication.worker-D2onu8ze.mjs:512:62)","Object.execute (manager-publication.worker-D2onu8ze.mjs:596:21)","Object.execute (sqlite-worker-binding-BQS0acWJ.mjs:14:19)","Object.execute (openclaw-agent-execution.worker.js:360:27)","executeCommand (openclaw-agent-execution.worker.js:1314:198)","(openclaw-agent-execution.worker.js:1391:58)","withPreparation (openclaw-agent-execution.worker.js:1090:14)","Object.execute (openclaw-agent-execution.worker.js:1391:12)","(sqlite-store.worker.js:310:80)","AsyncLocalStorage.run (node:internal(async_context_frame:65:14)","withSqliteDatabaseAdmissionExchange (sqlite-database-admission-Cfra70vw.mjs:1163:24)","(sqlite-worker-operation-admission-0TbdY4lt.mjs:163:163)","AsyncLocalStorage.run (node:internal(async_context_frame:65:14)","(sqlite-worker-operation-admission-0TbdY4lt.mjs:163:146)","AsyncLocalStorage.run (node:internal(async_context_frame:65:14)","withSqliteDatabaseAdmissionWait (sqlite-worker-database-admission-relay-jicqAZ-E.mjs:27:31)","runSqliteWorkerAdmissionScope (sqlite-worker-operation-admission-0TbdY4lt.mjs:163:9)"]}
```

The chain runs from the host admission broker (`runSqliteWorkerAdmissionScope`, `withSqliteDatabaseAdmissionExchange`) through the agent database execution worker into the publication worker; `manager-publication.worker-D2onu8ze.mjs:596` is inside its `command.type === "schema.admit"` branch (`dist-frames.out`). The base record has the same chain with `FROM memory_index_chunks_fts` and the virtual-table scan (`synthetic/base/obs-final/d2-search.jsonl`). Each first-admission reopen also logs the agent opener's integrity gate; patched CLI, in full (`synthetic/patched/logs/openclaw.log`):

```
{"0":"{\"subsystem\":\"state/agent-db\"}","1":{"agentId":"main","path":"<scratch>/runA/patched/state-noseal/agents/main/agent/openclaw-agent.sqlite","pid":5473,"threadId":6,"isMainThread":false,"admissionMode":"sync","integrityGateReason":"no-proof","integrityGateMode":"full","integrityGateOutcome":"healthy","integrityGateMs":129,"integrityCheckSyncMs":129,"integrityOutsideCheckMs":0,"canonicalIndexMs":17,"repairedIndexCount":0},"2":"agent database integrity gate","_meta":{"runtime":"node","runtimeVersion":"24.21.0","hostname":"<host>","date":"2026-10-17T14:09:11.301Z","logLevelId":3,"logLevelName":"INFO","name":"{\"subsystem\":\"state/agent-db\"}","parentNames":["openclaw"]},"time":"2026-10-17T07:09:11.301-07:00","hostname":"<host>","message":"agent database integrity gate","agent_id":"main"}
```

### Repair branch through the CLI

To exercise the branch where the counts differ, 10 rows were deleted from `memory_index_chunks_fts` with `node:sqlite` in a stopped, seal-removed copy of each arm's synthetic store. This is test-only fault injection, not a supported way to change an OpenClaw database (`synthetic/divergence/<arm>/inject.{mjs,out}`):

```
TEST-ONLY FAULT INJECTION
before {"memory_index_chunks":3626,"memory_index_chunks_fts":3626,"memory_index_chunks_fts_docsize":3626}
after {"memory_index_chunks":3626,"memory_index_chunks_fts":3616,"memory_index_chunks_fts_docsize":3616}
closed
```

`memory search "saffron glacier orchard" --json --agent main --max-results 25` on that copy then exited 0 on both builds, and its first-admission count saw the gap. Base read `canonical_count` 3626 and `derived_count` 3616 from the virtual table (2.156 ms); patched read the same 3626 and 3616 from `memory_index_chunks_fts_docsize` (0.027 ms). Both records came from the same worker chain as above (`synthetic/divergence/<arm>/obs/divergence.jsonl`). The repairing process wrote that one count record and no second one; the rebuild shows in the counts. After that process exited, the copy held 3,626 = 3,626 = 3,626 chunks, FTS rows and docsize rows on both builds (`inspect-counts.out`). The next `memory search` counted 3626 = 3626 on the receipt path (`obs/after.jsonl`). All four searches returned the same 25 results as the unmodified store (hash `b41508b9...6ac7`, `synthetic/divergence/summary.md`).

### Gateway

Each arm ran `gateway run --port <port> --bind loopback --auth token --token <test-token> --allow-unconfigured` on a copy of its synthetic store (`gateway/summary.md`). The shipped routes were `gateway call memory.status`, `gateway call memory.search` for five queries, and `memory search` from the CLI, which the CLI routed to the running gateway as `memory.search.owner`. All calls exited 0. `memory.status` reported 401 files and 3,626 chunks. Every observer record came from the gateway process on a worker thread with the same broker-to-`schema.admit` chain; no CLI client process ran the statement. Run 1 opened the copied store, which logged `integrityGateReason: "no-proof"` and took first admission. Run 2 reopened the same store after run 1's clean SIGTERM shutdown (`[shutdown] completed cleanly`, `clean-close receipt: written`) and took the receipt path. Each run produced 7 records per arm, all 3626 = 3626 (`gateway/<arm>/obs-gw/gateway.jsonl` for run 1, `obs-gw2` for run 2):

| Arm | Plan of the count | Run 1 statement ms | Run 2 statement ms |
|---|---|---|---|
| base | `SCAN memory_index_chunks_fts VIRTUAL TABLE INDEX 0:` | 2.041 to 2.38 | 11.779 (first), then 1.785 to 2.231 |
| patched | `SCAN memory_index_chunks_fts_docsize` | 0.049 to 0.063 | 4.739 (first), then 0.045 to 0.05 |

Patched gateway log, run 1 (`gateway/patched/logs-gw/openclaw.log`), in full:

```
{"0":"{\"subsystem\":\"state/agent-admission\"}","1":{"agentId":"main","paths":["<scratch>/runA/patched/state-gw/agents/main/agent/openclaw-agent.sqlite"],"elapsedMs":5779,"phaseDurationsMs":{"inspection":6,"activation":4225,"readiness":529,"open-wait":0,"open":723,"migration-wait":0,"migration":13,"publication-wait":0,"secrets":126,"models":146,"publication":10}},"2":"agent database recovered after background inspection and preparation","_meta":{"runtime":"node","runtimeVersion":"24.21.0","hostname":"<host>","date":"2026-10-17T14:22:22.459Z","logLevelId":3,"logLevelName":"INFO","name":"{\"subsystem\":\"state/agent-admission\"}","parentNames":["openclaw"]},"time":"2026-10-17T07:22:22.459-07:00","hostname":"<host>","message":"agent database recovered after background inspection and preparation","agent_id":"main"}
{"0":"{\"subsystem\":\"gateway/ws\"}","1":"⇄ res ✓ memory.search 51ms bytes=23207 conn=64db3d5a…72a9 id=2:60d11155-e…269e","_meta":{"runtime":"node","runtimeVersion":"24.21.0","hostname":"<host>","date":"2026-10-17T14:22:48.246Z","logLevelId":2,"logLevelName":"DEBUG","name":"{\"subsystem\":\"gateway/ws\"}","parentNames":["openclaw"]},"time":"2026-10-17T07:22:48.246-07:00","hostname":"<host>","message":"⇄ res ✓ memory.search 51ms bytes=23207 conn=64db3d5a…72a9 id=2:60d11155-e…269e","traceId":"d3ae180c1699d44a15741523241c98a4","spanId":"88bfecfe60e58dbf","traceFlags":"01"}
```

### Search parity

Hash = sha256 of the JSON array of `[path, startLine, endLine, score]` over the `results` array, in result order (`synthetic/parity.md`, `gateway/parity.md`, `real/parity.md`; the 1-hit and post-repair rows are in `synthetic/divergence/summary.md`, Parts 1 and 2). Query strings for the synthetic store are words from the generator's word list.

| Store | Route | Query | Hits base / patched | Hash base | Hash patched | Equal |
|---|---|---|---|---|---|---|
| synthetic | CLI | saffron glacier orchard | 25 / 25 | `b41508b9...6ac7` | `b41508b9...6ac7` | yes |
| synthetic | CLI | lorem ipsum | 25 / 25 | `c8b4dc84...6114` | `c8b4dc84...6114` | yes |
| synthetic | CLI | copper willow | 25 / 25 | `ebf7f74a...2085` | `ebf7f74a...2085` | yes |
| synthetic | CLI | harbor lantern meadow | 25 / 25 | `a01bd234...de67` | `a01bd234...de67` | yes |
| synthetic | CLI | cobalt ember tundra | 25 / 25 | `847834bb...a828` | `847834bb...a828` | yes |
| synthetic | gateway `memory.search`, runs 1 and 2 | the same five | 25 / 25 each | same five hashes | same five hashes | yes |
| synthetic | CLI routed to gateway (`memory.search.owner`) | saffron glacier orchard | 25 / 25 | `b41508b9...6ac7` | `b41508b9...6ac7` | yes |
| synthetic | CLI | synthetic | 1 / 1 | `8f20c572...793c` | `8f20c572...793c` | yes |
| synthetic | CLI | marker phrase | 1 / 1 | `b62e2dcd...85c5` | `b62e2dcd...85c5` | yes |
| synthetic | CLI, seal removed (first admission) | saffron glacier orchard | 25 / 25 | `b41508b9...6ac7` | `b41508b9...6ac7` | yes |
| synthetic | CLI, after the FTS repair above | saffron glacier orchard | 25 / 25 | `b41508b9...6ac7` | `b41508b9...6ac7` | yes |
| real dev copy | CLI, 3 queries, 2 variants | private | 25 / 25 each | see `real/parity.md` | see `real/parity.md` | order, paths and line ranges yes; scores differ by at most 2.3e-5 |
| real main copy | CLI, 3 queries, 4 variants | private | 0 / 0 each | empty list | empty list | yes (stdout byte-identical) |

The two 1-hit queries compare the whole result set, not only the first 25. On the synthetic store scores are exactly equal, and full stdout differs between arms only in `provenance.observedAt` (each arm has its own copy of the workspace files; 0 differing lines after removing that field, `synthetic/parity.md`). Within each arm, stdout from observer-off runs is byte-identical to the observer-on runs of the same query, on both paths (`synthetic/divergence/summary.md`, Part 3). On the dev copy the scores carry a time-dependent term: two runs of the same arm differ by up to 2.95e-4, larger than the 2.3e-5 difference between arms (`real/parity.md`, Score drift).

### Real store copies (private, counts only)

The two snapshots used in Evidence (43,490 and 6,012 chunks, sha256 verified on local disk) are at agent schema 24. The first `memory search` on either build refused them (`real/errors.md`):

```
memory search failed (main): OpenClaw agent database <path> uses schema version 24; stop active agents and run openclaw doctor --fix to migrate session identities before using it.
```

Each arm migrated its own copy with its own `doctor --fix --non-interactive`. In a state dir holding only the copied agent database, doctor first holds the store until it is registered again; after the restore command doctor prints (`agents add <id> --workspace <path> --agent-dir <path> --non-interactive`), a second doctor run reported `Upgraded agent database schema in <path> v24 -> v28.` on both builds, with the counts unchanged: 43,490 = 43,490 = 43,490 and 6,012 = 6,012 = 6,012 (chunks, FTS, docsize; `real/migration.md`). The searches used the store's own provider, model, sources and tokenizer settings with the embedding endpoint on a loopback address where nothing listens (the provider's default local port for the dev copy, `127.0.0.1:19999` for the main copy), so the requested index repair fails, the index stays unchanged, and no request leaves the host (`real/errors.md` items 5 and 6, `real/counts.md`). The main copy then returns an empty result list marked stale on both builds.

Count statement on the migrated copies, from the shipped CLI's `memory search`, all on a worker thread, all records with canonical = derived (`real/observer-aggregate.out`, raw records in `real/observer/`). Records with 0 canonical chunks (a second, empty database admitted in the same processes) are left out. n counts observer records, not processes: one process can admit the store more than once, and the record count per process varies with the step (for example `real/observer/dev-base-s4-q1.jsonl` holds two records at 6,012 chunks and `dev-patched-s4-q1.jsonl` one), so n differs by one between arms on the dev first-admission row.

| Store | Path | Base ms (n records, median, range) | Patched ms (n records, median, range) |
|---|---|---|---|
| main, 43,490 chunks | first admission | 26, 25.784, 22.084 to 30.763 | 26, 0.552, 0.451 to 0.654 |
| main | receipt | 3, 27.342, 26.314 to 2030.267 | 3, 0.46, 0.438 to 73.921 |
| dev, 6,012 chunks | first admission | 13, 2.791, 2.558 to 3.427 | 12, 0.08, 0.068 to 0.088 |
| dev | receipt | 3, 3.348, 2.875 to 182.195 | 3, 0.11, 0.108 to 5.279 |

The largest value in each receipt row is the first open after a fresh copy (cold pages): 2,030.267 ms base and 73.921 ms patched on the main copy.

### Reopen wall time

Whole `memory search` process, observer off, 5 fresh processes per arm, interleaved, median ms (`synthetic/timings.md`, `real/timings.md` blocks seal-M and noseal-M, raw values and load averages included; the real copies ran at full chunk counts):

| Store | Path | Base | Patched |
|---|---|---|---|
| synthetic, 3,626 chunks | receipt | 4,138.7 | 4,068.2 |
| synthetic | first admission | 4,179.6 | 4,145.2 |
| real dev, 6,012 chunks | receipt | 7,682.6 | 7,780.0 |
| real dev | first admission | 10,657.7 | 10,441.2 |
| real main, 43,490 chunks | receipt | 6,597.0 | 6,819.4 |
| real main | first admission | 30,784.3 | 32,138.4 |

The patched median is lower in three rows and higher in three, by at most 4.4 percent (main first admission, base 29,201.6 to 31,704.3 ms, patched 31,874.3 to 32,381.0 ms). The order reversed on fresh copies of the same migrated main store run with `provider: "none"` (admission at 43,490 chunks, then the destructive sync described in Gaps): first admission 29,733.9 ms base against 29,547.6 ms patched (`real/timings.md`, block noseal-N). The count statement saves about 25 ms per warm admission on the main copy, which is under 1 percent of a process that loads plugins and, on first admission, runs the integrity gate; that gate alone took 23,767 ms in one base run and 20,314 ms in one patched run on the main copy (`real/integrity-gate.md`). Whole-process time does not isolate the change; the statement-level timings above do. The synthetic and dev blocks ran at 1-minute load averages of about 6 to 25, the main blocks at about 2 to 6.

## Gaps, stated plainly

- `pnpm changed:lanes --json` for this diff returns `core: true, coreTests: true` and every other lane false, with `extensionImpactFromCore: false`. The host directory of the memory SDK and the 15 memory-core admission consumer files ran anyway because they are the production callers of the changed function. Unrelated suites were not run.
- The two `check:changed` failures above are in files outside this diff and reproduce on a clean checkout of the base; they are not addressed here.
- The admission timing tables in Evidence come from the harness, which runs the same built exports in the `schema.admit` handler's order on the main thread with the private-shadow opener; those absolute numbers are a lower bound of the worker-path cost. The shipped-entry runs in Real behavior proof go through the publication worker, the host admission broker and the agent opener on migrated copies of the same stores, and show the same plans, equal counts, and count-statement times of the same size (main copy, warm: 25.784 ms base to 0.552 ms patched median on first admission). They time the one statement, not the whole admission; whole-process wall time does not resolve the difference.
- The reconcile emits no log line, so the shipped-entry runs observe it with a read-only `node:sqlite` preload (`observe-reconcile-count.mjs`); no OpenClaw source was changed for them. The repair branch was reached through the CLI only by deleting FTS rows from a stopped copy, and its rebuild is shown by the counts before and after, not by a log line.
- On the real copies, `provider: "none"` made the first search request an index repair, and its sync against the empty test workspace removed sources from the copy (main 43,490 to 6,809 chunks, dev 6,012 to 5,863, equally on both builds, `real/counts.md`). Those runs are not used for the parity table or the wall-time table. With the stores' own embedding settings and an unreachable loopback endpoint, the main copy returns no hits on either build, so real-store ranked parity rests on the dev copy; the synthetic store covers ranked parity through the CLI and the gateway.
- A copied store with its seal file is not accepted as a clean close (`integrityGateReason: "no-proof"`), so receipt-path runs reopen a store in place after its previous clean exit. `doctor --fix` on a state dir holding only a copied agent database first held the store and needed the `agents add` restore command it printed before it migrated (`real/migration.md`).
- The harness takes the first-admission path in a fresh process and measures the already-admitted path as the second call in the same process. It cannot reproduce a receipt restored from a clean-close seal, and it does not measure the already-admitted path cold. The first call of each already-admitted process is a first admission and is not counted; one such call on the main store logged a 5,166 ms transaction hold during a load spike, outside the measured runs.
- One host, two stores, macOS only, and `unicode61` tokenizer stores only. The `trigram` tokenizer is covered only by the scratch parity check and the existing tests.
- "Cold" is a fresh `F_NOCACHE` copy per run, not a purged OS cache. The cold-read validation ran at a 1-minute load average of 52.89. The warm and cold rounds ran at 1-minute load averages of 5.08 to 11.11 (the first dev warm round waited 1,080 s for it to fall below 8). The already-admitted rounds had no load gate and ran at 1-minute load averages from 9.15 to 34.52, so those two rows are noisier. Single cold runs vary widely (one BEFORE run on the main store took 6158.192 ms), which is why medians are reported.
- Out of scope: whether the reconcile should also run on the already-admitted path. It runs on both paths today (both measured above), and this change keeps where and how often it runs, its decision and its repair, and changes only which table its count reads.
- If `%_content` and `%_docsize` ever disagreed through corruption or an out-of-band writer, the count now follows `%_docsize`. Neither form detects a row whose text drifted while the count stayed equal, before or after this change.
