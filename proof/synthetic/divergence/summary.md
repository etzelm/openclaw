# PR #175555 proof, runC (divergence control, low-hit queries, observer-off equivalence)

Observer sha256 verified: 6311a30bc56fda668412f27c140a5318f57e22f6e6a383a3b1aa6b98a3267645 (matches).

## Part 1: divergence control (TEST-ONLY FAULT INJECTION)

Fault injection: after copying runA/<arm>/state-noseal-pristine to runC/<arm>/state, 10 rows were deleted from memory_index_chunks_fts with node:sqlite while no openclaw process ran. This is test-only, not a product path.
Config workspace path still points at runA/<arm>/state/workspace (unchanged). One deviation: logging.file in the runC copy of openclaw.json was redirected from runA/<arm>/logs/openclaw.log to runC/<arm>/logs/openclaw.log so runA evidence logs are not appended to. HOME is a cp -a of runA/<arm>/home.
No agent-db .seal existed before the divergence run (only state/state/openclaw.sqlite.seal for the global db); the run wrote agents/main/agent/openclaw-agent.sqlite.seal afterwards.
Query: saffron glacier orchard --json --agent main --max-results 25. Known hash: b41508b9c1925511d8c1992bb5edbcfc93c50bf34e0519e7c9ff34a182106ac7

### base

inject.out:
```
TEST-ONLY FAULT INJECTION
before {"memory_index_chunks":3626,"memory_index_chunks_fts":3626,"memory_index_chunks_fts_docsize":3626}
after {"memory_index_chunks":3626,"memory_index_chunks_fts":3616,"memory_index_chunks_fts_docsize":3616}
closed
```

Observer record, divergence run (obs/divergence.jsonl), verbatim:
```
{"event":"reconcile_count","pid":37214,"threadId":6,"isMainThread":false,"inTransaction":true,"sql":"SELECT (SELECT COUNT(*) FROM memory_index_chunks) AS canonical_count, (SELECT COUNT(*) FROM memory_index_chunks_fts) AS derived_count","plan":["SCAN CONSTANT ROW","SCALAR SUBQUERY 1","SCAN memory_index_chunks USING COVERING INDEX idx_memory_index_chunks_source","SCALAR SUBQUERY 2","SCAN memory_index_chunks_fts VIRTUAL TABLE INDEX 0:"],"canonical_count":3626,"derived_count":3616,"stmt_ms":2.156,"callers":["callStatement (sqlite-schema-facts-Bql6amq4.mjs:199:17)","(sqlite-schema-facts-Bql6amq4.mjs:250:72)","reset (sqlite-schema-facts-Bql6amq4.mjs:243:34)","(sqlite-schema-facts-Bql6amq4.mjs:250:60)","execute (sqlite-schema-facts-Bql6amq4.mjs:224:19)","StatementSync.<anonymous> (sqlite-schema-facts-Bql6amq4.mjs:250:46)","(adapters-BmfPXTHu.mjs:132:90)","observeDatabaseOperation (adapters-BmfPXTHu.mjs:77:37)","StatementSync.value [as get] (adapters-BmfPXTHu.mjs:132:31)","reconcileMemoryChunkFtsRows (search-admission-wNFq-T-l.mjs:323:64)","admitSqliteMemoryTextSearch (search-admission-wNFq-T-l.mjs:354:3)","admitStoreSearchExtension (search-admission-wNFq-T-l.mjs:417:55)","admitStoreSearch (search-admission-wNFq-T-l.mjs:459:10)","ensureMemoryIndexSchema (memory-schema-0H_deEG2.mjs:858:3)","(manager-publication.worker-CJ0OnAIL.mjs:596:33)","withSqliteDatabaseWriteScope (sqlite-database-admission-Cfra70vw.mjs:537:18)","runSqliteImmediateTransactionSync.withCommit (manager-publication.worker-CJ0OnAIL.mjs:514:10)","runSqliteReadOperationSync (sqlite-schema-facts-Bql6amq4.mjs:701:10)","settleSqliteTransactionSync (sqlite-transaction-DNFHtRy9.mjs:287:54)","runSqliteTransactionSync (sqlite-transaction-DNFHtRy9.mjs:255:9)","(sqlite-transaction-DNFHtRy9.mjs:344:52)","withSqlitePostCommitPublications (sqlite-post-commit-B-fc95zq.mjs:138:12)","runSqliteImmediateTransactionSync (sqlite-transaction-DNFHtRy9.mjs:344:9)","(manager-publication.worker-CJ0OnAIL.mjs:512:82)","transact (manager-publication.worker-CJ0OnAIL.mjs:486:12)","write (manager-publication.worker-CJ0OnAIL.mjs:512:62)","Object.execute (manager-publication.worker-CJ0OnAIL.mjs:596:21)","Object.execute (sqlite-worker-binding-BQS0acWJ.mjs:14:19)","Object.execute (openclaw-agent-execution.worker.js:360:27)","executeCommand (openclaw-agent-execution.worker.js:1314:198)","(openclaw-agent-execution.worker.js:1391:58)","withPreparation (openclaw-agent-execution.worker.js:1090:14)","Object.execute (openclaw-agent-execution.worker.js:1391:12)","(sqlite-store.worker.js:310:80)","AsyncLocalStorage.run (node:internal(async_context_frame:65:14)","withSqliteDatabaseAdmissionExchange (sqlite-database-admission-Cfra70vw.mjs:1163:24)","(sqlite-worker-operation-admission-0TbdY4lt.mjs:163:163)","AsyncLocalStorage.run (node:internal(async_context_frame:65:14)","(sqlite-worker-operation-admission-0TbdY4lt.mjs:163:146)","AsyncLocalStorage.run (node:internal(async_context_frame:65:14)"]}
```

Counts of db copy taken after the divergence search (readOnly; chunks, fts, docsize):
```
{"memory_index_chunks":3626,"memory_index_chunks_fts":3626,"memory_index_chunks_fts_docsize":3626}
```

Observer record, second search (obs/after.jsonl), verbatim:
```
{"event":"reconcile_count","pid":37250,"threadId":5,"isMainThread":false,"inTransaction":true,"sql":"SELECT (SELECT COUNT(*) FROM memory_index_chunks) AS canonical_count, (SELECT COUNT(*) FROM memory_index_chunks_fts) AS derived_count","plan":["SCAN CONSTANT ROW","SCALAR SUBQUERY 1","SCAN memory_index_chunks USING COVERING INDEX idx_memory_index_chunks_source","SCALAR SUBQUERY 2","SCAN memory_index_chunks_fts VIRTUAL TABLE INDEX 0:"],"canonical_count":3626,"derived_count":3626,"stmt_ms":1.824,"callers":["callStatement (sqlite-schema-facts-Bql6amq4.mjs:199:17)","(sqlite-schema-facts-Bql6amq4.mjs:250:72)","reset (sqlite-schema-facts-Bql6amq4.mjs:243:34)","(sqlite-schema-facts-Bql6amq4.mjs:250:60)","execute (sqlite-schema-facts-Bql6amq4.mjs:224:19)","StatementSync.<anonymous> (sqlite-schema-facts-Bql6amq4.mjs:250:46)","(adapters-BmfPXTHu.mjs:132:90)","observeDatabaseOperation (adapters-BmfPXTHu.mjs:77:37)","StatementSync.value [as get] (adapters-BmfPXTHu.mjs:132:31)","reconcileMemoryChunkFtsRows (search-admission-wNFq-T-l.mjs:323:64)","reconcile (memory-schema-0H_deEG2.mjs:765:5)","ensureMemoryIndexSchema (memory-schema-0H_deEG2.mjs:768:33)","(manager-publication.worker-CJ0OnAIL.mjs:596:33)","withSqliteDatabaseWriteScope (sqlite-database-admission-Cfra70vw.mjs:537:18)","runSqliteImmediateTransactionSync.withCommit (manager-publication.worker-CJ0OnAIL.mjs:514:10)","runSqliteReadOperationSync (sqlite-schema-facts-Bql6amq4.mjs:701:10)","settleSqliteTransactionSync (sqlite-transaction-DNFHtRy9.mjs:287:54)","runSqliteTransactionSync (sqlite-transaction-DNFHtRy9.mjs:255:9)","(sqlite-transaction-DNFHtRy9.mjs:344:52)","withSqlitePostCommitPublications (sqlite-post-commit-B-fc95zq.mjs:138:12)","runSqliteImmediateTransactionSync (sqlite-transaction-DNFHtRy9.mjs:344:9)","(manager-publication.worker-CJ0OnAIL.mjs:512:82)","transact (manager-publication.worker-CJ0OnAIL.mjs:486:12)","write (manager-publication.worker-CJ0OnAIL.mjs:512:62)","Object.execute (manager-publication.worker-CJ0OnAIL.mjs:596:21)","Object.execute (sqlite-worker-binding-BQS0acWJ.mjs:14:19)","Object.execute (openclaw-agent-execution.worker.js:360:27)","executeCommand (openclaw-agent-execution.worker.js:1314:198)","(openclaw-agent-execution.worker.js:1391:58)","withPreparation (openclaw-agent-execution.worker.js:1090:14)","Object.execute (openclaw-agent-execution.worker.js:1391:12)","(sqlite-store.worker.js:310:80)","AsyncLocalStorage.run (node:internal(async_context_frame:65:14)","withSqliteDatabaseAdmissionExchange (sqlite-database-admission-Cfra70vw.mjs:1163:24)","(sqlite-worker-operation-admission-0TbdY4lt.mjs:163:163)","AsyncLocalStorage.run (node:internal(async_context_frame:65:14)","(sqlite-worker-operation-admission-0TbdY4lt.mjs:163:146)","AsyncLocalStorage.run (node:internal(async_context_frame:65:14)","withSqliteDatabaseAdmissionWait (sqlite-worker-database-admission-relay-jicqAZ-E.mjs:27:31)","runSqliteWorkerAdmissionScope (sqlite-worker-operation-admission-0TbdY4lt.mjs:163:9)"]}
```

Exit codes: divergence 0, after 0. ms: 4011.6 / 3635.0.

### patched

inject.out:
```
TEST-ONLY FAULT INJECTION
before {"memory_index_chunks":3626,"memory_index_chunks_fts":3626,"memory_index_chunks_fts_docsize":3626}
after {"memory_index_chunks":3626,"memory_index_chunks_fts":3616,"memory_index_chunks_fts_docsize":3616}
closed
```

Observer record, divergence run (obs/divergence.jsonl), verbatim:
```
{"event":"reconcile_count","pid":37298,"threadId":6,"isMainThread":false,"inTransaction":true,"sql":"SELECT (SELECT COUNT(*) FROM memory_index_chunks) AS canonical_count, (SELECT COUNT(*) FROM memory_index_chunks_fts_docsize) AS derived_count","plan":["SCAN CONSTANT ROW","SCALAR SUBQUERY 1","SCAN memory_index_chunks USING COVERING INDEX idx_memory_index_chunks_source","SCALAR SUBQUERY 2","SCAN memory_index_chunks_fts_docsize"],"canonical_count":3626,"derived_count":3616,"stmt_ms":0.027,"callers":["callStatement (sqlite-schema-facts-Bql6amq4.mjs:199:17)","(sqlite-schema-facts-Bql6amq4.mjs:250:72)","reset (sqlite-schema-facts-Bql6amq4.mjs:243:34)","(sqlite-schema-facts-Bql6amq4.mjs:250:60)","execute (sqlite-schema-facts-Bql6amq4.mjs:224:19)","StatementSync.<anonymous> (sqlite-schema-facts-Bql6amq4.mjs:250:46)","(adapters-DqCbKFAM.mjs:132:90)","observeDatabaseOperation (adapters-DqCbKFAM.mjs:77:37)","StatementSync.value [as get] (adapters-DqCbKFAM.mjs:132:31)","reconcileMemoryChunkFtsRows (search-admission-DU3mLXRY.mjs:323:72)","admitSqliteMemoryTextSearch (search-admission-DU3mLXRY.mjs:354:3)","admitStoreSearchExtension (search-admission-DU3mLXRY.mjs:417:55)","admitStoreSearch (search-admission-DU3mLXRY.mjs:459:10)","ensureMemoryIndexSchema (memory-schema-D98KV85k.mjs:858:3)","(manager-publication.worker-D2onu8ze.mjs:596:33)","withSqliteDatabaseWriteScope (sqlite-database-admission-Cfra70vw.mjs:537:18)","runSqliteImmediateTransactionSync.withCommit (manager-publication.worker-D2onu8ze.mjs:514:10)","runSqliteReadOperationSync (sqlite-schema-facts-Bql6amq4.mjs:701:10)","settleSqliteTransactionSync (sqlite-transaction-DNFHtRy9.mjs:287:54)","runSqliteTransactionSync (sqlite-transaction-DNFHtRy9.mjs:255:9)","(sqlite-transaction-DNFHtRy9.mjs:344:52)","withSqlitePostCommitPublications (sqlite-post-commit-B-fc95zq.mjs:138:12)","runSqliteImmediateTransactionSync (sqlite-transaction-DNFHtRy9.mjs:344:9)","(manager-publication.worker-D2onu8ze.mjs:512:82)","transact (manager-publication.worker-D2onu8ze.mjs:486:12)","write (manager-publication.worker-D2onu8ze.mjs:512:62)","Object.execute (manager-publication.worker-D2onu8ze.mjs:596:21)","Object.execute (sqlite-worker-binding-BQS0acWJ.mjs:14:19)","Object.execute (openclaw-agent-execution.worker.js:360:27)","executeCommand (openclaw-agent-execution.worker.js:1314:198)","(openclaw-agent-execution.worker.js:1391:58)","withPreparation (openclaw-agent-execution.worker.js:1090:14)","Object.execute (openclaw-agent-execution.worker.js:1391:12)","(sqlite-store.worker.js:310:80)","AsyncLocalStorage.run (node:internal(async_context_frame:65:14)","withSqliteDatabaseAdmissionExchange (sqlite-database-admission-Cfra70vw.mjs:1163:24)","(sqlite-worker-operation-admission-0TbdY4lt.mjs:163:163)","AsyncLocalStorage.run (node:internal(async_context_frame:65:14)","(sqlite-worker-operation-admission-0TbdY4lt.mjs:163:146)","AsyncLocalStorage.run (node:internal(async_context_frame:65:14)"]}
```

Counts of db copy taken after the divergence search (readOnly; chunks, fts, docsize):
```
{"memory_index_chunks":3626,"memory_index_chunks_fts":3626,"memory_index_chunks_fts_docsize":3626}
```

Observer record, second search (obs/after.jsonl), verbatim:
```
{"event":"reconcile_count","pid":37332,"threadId":5,"isMainThread":false,"inTransaction":true,"sql":"SELECT (SELECT COUNT(*) FROM memory_index_chunks) AS canonical_count, (SELECT COUNT(*) FROM memory_index_chunks_fts_docsize) AS derived_count","plan":["SCAN CONSTANT ROW","SCALAR SUBQUERY 1","SCAN memory_index_chunks USING COVERING INDEX idx_memory_index_chunks_source","SCALAR SUBQUERY 2","SCAN memory_index_chunks_fts_docsize"],"canonical_count":3626,"derived_count":3626,"stmt_ms":0.047,"callers":["callStatement (sqlite-schema-facts-Bql6amq4.mjs:199:17)","(sqlite-schema-facts-Bql6amq4.mjs:250:72)","reset (sqlite-schema-facts-Bql6amq4.mjs:243:34)","(sqlite-schema-facts-Bql6amq4.mjs:250:60)","execute (sqlite-schema-facts-Bql6amq4.mjs:224:19)","StatementSync.<anonymous> (sqlite-schema-facts-Bql6amq4.mjs:250:46)","(adapters-DqCbKFAM.mjs:132:90)","observeDatabaseOperation (adapters-DqCbKFAM.mjs:77:37)","StatementSync.value [as get] (adapters-DqCbKFAM.mjs:132:31)","reconcileMemoryChunkFtsRows (search-admission-DU3mLXRY.mjs:323:72)","reconcile (memory-schema-D98KV85k.mjs:765:5)","ensureMemoryIndexSchema (memory-schema-D98KV85k.mjs:768:33)","(manager-publication.worker-D2onu8ze.mjs:596:33)","withSqliteDatabaseWriteScope (sqlite-database-admission-Cfra70vw.mjs:537:18)","runSqliteImmediateTransactionSync.withCommit (manager-publication.worker-D2onu8ze.mjs:514:10)","runSqliteReadOperationSync (sqlite-schema-facts-Bql6amq4.mjs:701:10)","settleSqliteTransactionSync (sqlite-transaction-DNFHtRy9.mjs:287:54)","runSqliteTransactionSync (sqlite-transaction-DNFHtRy9.mjs:255:9)","(sqlite-transaction-DNFHtRy9.mjs:344:52)","withSqlitePostCommitPublications (sqlite-post-commit-B-fc95zq.mjs:138:12)","runSqliteImmediateTransactionSync (sqlite-transaction-DNFHtRy9.mjs:344:9)","(manager-publication.worker-D2onu8ze.mjs:512:82)","transact (manager-publication.worker-D2onu8ze.mjs:486:12)","write (manager-publication.worker-D2onu8ze.mjs:512:62)","Object.execute (manager-publication.worker-D2onu8ze.mjs:596:21)","Object.execute (sqlite-worker-binding-BQS0acWJ.mjs:14:19)","Object.execute (openclaw-agent-execution.worker.js:360:27)","executeCommand (openclaw-agent-execution.worker.js:1314:198)","(openclaw-agent-execution.worker.js:1391:58)","withPreparation (openclaw-agent-execution.worker.js:1090:14)","Object.execute (openclaw-agent-execution.worker.js:1391:12)","(sqlite-store.worker.js:310:80)","AsyncLocalStorage.run (node:internal(async_context_frame:65:14)","withSqliteDatabaseAdmissionExchange (sqlite-database-admission-Cfra70vw.mjs:1163:24)","(sqlite-worker-operation-admission-0TbdY4lt.mjs:163:163)","AsyncLocalStorage.run (node:internal(async_context_frame:65:14)","(sqlite-worker-operation-admission-0TbdY4lt.mjs:163:146)","AsyncLocalStorage.run (node:internal(async_context_frame:65:14)","withSqliteDatabaseAdmissionWait (sqlite-worker-database-admission-relay-jicqAZ-E.mjs:27:31)","runSqliteWorkerAdmissionScope (sqlite-worker-operation-admission-0TbdY4lt.mjs:163:9)"]}
```

Exit codes: divergence 0, after 0. ms: 4074.2 / 3670.8.

### Findings

- Divergence record: canonical 3626 vs derived 3616 (base reads memory_index_chunks_fts, patched reads memory_index_chunks_fts_docsize). Plan shows the derived table scan. Caller path: reconcileMemoryChunkFtsRows < admitSqliteMemoryTextSearch < admitStoreSearchExtension < admitStoreSearch < ensureMemoryIndexSchema < manager-publication.worker, on worker thread (isMainThread false).
- The string rebuildMemoryChunkFts does not appear in any saved log, err, or obs file (the observer only samples the count statement, and the stack is captured before the repair runs; openclaw.log has no rebuild/repair text). The repair is evidenced by the counts: 3616 observed, then 3626/3626/3626 in the db copy taken after the run, and the second search sees 3626 vs 3626 on the (non-admission) reconcile path via ensureMemoryIndexSchema.
- The first search produced only one count record (no re-count after repair).
- Search result hash (sha256 of [path,startLine,endLine,score] over results): all four runs (base/patched x divergence/after) = b41508b9c1925511d8c1992bb5edbcfc93c50bf34e0519e7c9ff34a182106ac7, 25 hits, equal to the known hash.

## Part 2: low-hit queries (runA stores in place, seal path, observer on)

| query | arm | hits | sha256 | exit |
|---|---|---|---|---|
| synthetic | base | 1 | 8f20c5729f65066094ce6911ca474c12f4a72bed588d74d08fe61f86f0c4793c | 0 |
| synthetic | patched | 1 | 8f20c5729f65066094ce6911ca474c12f4a72bed588d74d08fe61f86f0c4793c | 0 |
| marker phrase | base | 1 | b62e2dcd67fd8ce80f88584b8ca51c36478f115a37d974b4ae835efea9f085c5 | 0 |
| marker phrase | patched | 1 | b62e2dcd67fd8ce80f88584b8ca51c36478f115a37d974b4ae835efea9f085c5 | 0 |

Both queries return 1 hit (fewer than 25), so the full result set is compared. Hashes equal across arms for both queries. runA agent db main-file sha256 prefix unchanged before/after (base b48a231c87cef8f1, patched 223ea05ecb578c89); counts after 3626/3626/3626 in both arms. Steps named g1-synthetic and g2-marker-phrase in logs-final/obs-final. The runA config logging.file still appends to runA/<arm>/logs/openclaw.log, as in earlier steps.

## Part 3: observer-off vs observer-on equivalence (diff line count after removing observedAt lines)

| arm | pair | diff lines |
|---|---|---|
| base | logs/f-seal-1.out vs logs-final/d1-search.out | 0 |
| base | logs/f-noseal-1.out vs logs-final/e-noseal-search.out | 0 |
| patched | logs/f-seal-1.out vs logs-final/d1-search.out | 0 |
| patched | logs/f-noseal-1.out vs logs-final/e-noseal-search.out | 0 |

Raw (unfiltered) diffs were also 0 lines.

## Errors

None. All commands exited 0.
