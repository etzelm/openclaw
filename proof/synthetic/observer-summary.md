# Observer summary

Statement observed: `SELECT (SELECT COUNT(*) FROM memory_index_chunks) AS canonical_count, (SELECT COUNT(*) FROM memory_index_chunks_fts[_docsize]) AS derived_count`. Counts from step b (copy): chunks=3626, fts=3626, docsize=3626.

| arm | step | records | pid | threadId | isMainThread | derived table | plan (last line) | canonical | derived | stmt_ms | reconcile caller chain |
|---|---|---|---|---|---|---|---|---|---|---|---|
| base | a-index | 2 | 2865 | 6 | false | memory_index_chunks_fts | SCAN memory_index_chunks_fts VIRTUAL TABLE INDEX 0: | 0 | 0 | 0.042 | (stack limit 10 frames, not visible) |
| base | a-index | 2 | 2865 | 10 | false | memory_index_chunks_fts | SCAN memory_index_chunks_fts VIRTUAL TABLE INDEX 0: | 0 | 0 | 0.028 | reconcileMemoryChunkFtsRows < admitSqliteMemoryTextSearch < admitStoreSearchExtension |
| base | d1-search | 1 | 3288 | 5 | false | memory_index_chunks_fts | SCAN memory_index_chunks_fts VIRTUAL TABLE INDEX 0: | 3626 | 3626 | 7.327 | (stack limit 10 frames, not visible) |
| base | d2-search | 1 | 3332 | 5 | false | memory_index_chunks_fts | SCAN memory_index_chunks_fts VIRTUAL TABLE INDEX 0: | 3626 | 3626 | 1.81 | (stack limit 10 frames, not visible) |
| base | d3-search | 1 | 3464 | 5 | false | memory_index_chunks_fts | SCAN memory_index_chunks_fts VIRTUAL TABLE INDEX 0: | 3626 | 3626 | 1.908 | (stack limit 10 frames, not visible) |
| base | d4-search | 1 | 3573 | 5 | false | memory_index_chunks_fts | SCAN memory_index_chunks_fts VIRTUAL TABLE INDEX 0: | 3626 | 3626 | 1.95 | (stack limit 10 frames, not visible) |
| base | d5-search | 1 | 3618 | 5 | false | memory_index_chunks_fts | SCAN memory_index_chunks_fts VIRTUAL TABLE INDEX 0: | 3626 | 3626 | 1.953 | (stack limit 10 frames, not visible) |
| base | e-noseal-search | 1 | 4200 | 6 | false | memory_index_chunks_fts | SCAN memory_index_chunks_fts VIRTUAL TABLE INDEX 0: | 3626 | 3626 | 2.308 | reconcileMemoryChunkFtsRows < admitSqliteMemoryTextSearch < admitStoreSearchExtension < admitStoreSearch < ensureMemoryIndexSchema |
| base | e2-seal-search-deep | 1 | 4230 | 5 | false | memory_index_chunks_fts | SCAN memory_index_chunks_fts VIRTUAL TABLE INDEX 0: | 3626 | 3626 | 12.945 | reconcileMemoryChunkFtsRows < reconcile < ensureMemoryIndexSchema < (manager-publication.worker-CJ0OnAIL.mjs:596:33) < withSqliteDatabaseWriteScope |
| patched | a-index | 2 | 2969 | 9 | false | memory_index_chunks_fts_docsize | SCAN memory_index_chunks_fts_docsize | 0 | 0 | 0.006 | (stack limit 10 frames, not visible) |
| patched | a-index | 2 | 2969 | 13 | false | memory_index_chunks_fts_docsize | SCAN memory_index_chunks_fts_docsize | 0 | 0 | 0.004 | reconcileMemoryChunkFtsRows < admitSqliteMemoryTextSearch < admitStoreSearchExtension |
| patched | d1-search | 1 | 3902 | 5 | false | memory_index_chunks_fts_docsize | SCAN memory_index_chunks_fts_docsize | 3626 | 3626 | 2.092 | (stack limit 10 frames, not visible) |
| patched | d2-search | 1 | 3953 | 5 | false | memory_index_chunks_fts_docsize | SCAN memory_index_chunks_fts_docsize | 3626 | 3626 | 0.052 | (stack limit 10 frames, not visible) |
| patched | d3-search | 1 | 4001 | 5 | false | memory_index_chunks_fts_docsize | SCAN memory_index_chunks_fts_docsize | 3626 | 3626 | 0.053 | (stack limit 10 frames, not visible) |
| patched | d4-search | 1 | 4029 | 5 | false | memory_index_chunks_fts_docsize | SCAN memory_index_chunks_fts_docsize | 3626 | 3626 | 0.061 | (stack limit 10 frames, not visible) |
| patched | d5-search | 1 | 4066 | 5 | false | memory_index_chunks_fts_docsize | SCAN memory_index_chunks_fts_docsize | 3626 | 3626 | 0.053 | (stack limit 10 frames, not visible) |
| patched | e-noseal-search | 1 | 4260 | 6 | false | memory_index_chunks_fts_docsize | SCAN memory_index_chunks_fts_docsize | 3626 | 3626 | 0.042 | reconcileMemoryChunkFtsRows < admitSqliteMemoryTextSearch < admitStoreSearchExtension < admitStoreSearch < ensureMemoryIndexSchema |
| patched | e2-seal-search-deep | 1 | 4290 | 5 | false | memory_index_chunks_fts_docsize | SCAN memory_index_chunks_fts_docsize | 3626 | 3626 | 0.063 | reconcileMemoryChunkFtsRows < reconcile < ensureMemoryIndexSchema < (manager-publication.worker-D2onu8ze.mjs:596:33) < withSqliteDatabaseWriteScope |

Steps c1 (status --json) and c2 (status --deep) produced no observer file: status takes the read-only open path and runs no reconcile statement.
Steps a-index (first record on empty DB at store creation, second from the publication worker first-admission path) show counts 0/0 because the store was just created.
