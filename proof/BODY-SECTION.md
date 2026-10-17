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
