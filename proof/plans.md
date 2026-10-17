# Query plans (EXPLAIN QUERY PLAN, captured at the first run of each distinct SQL text with the real bound values; values not stored)

Shapes: chunk_keyword (FTS rank query on memory_index_chunks_fts), path_exact, path_lexical (two SQL texts: the lexical and a substring/second variant), reconcile_count (unrelated derived-count statement, shown for completeness). sqlHash is the first 12 hex of sha256 of the whitespace-collapsed SQL; it differs between arms for the changed statements because the SQL text differs (`LIMIT +?`, `LIKE (? || '')`).

## gateway c1

### reconcile_count: before has 1 distinct SQL text(s), after has 1; plans identical in order: true

before [3d5b652d4207] #1:
```
SCAN CONSTANT ROW
SCALAR SUBQUERY 1
SCAN memory_index_chunks USING COVERING INDEX idx_memory_index_chunks_source
SCALAR SUBQUERY 2
SCAN memory_index_chunks_fts_docsize
```
after [3d5b652d4207] #1:
```
SCAN CONSTANT ROW
SCALAR SUBQUERY 1
SCAN memory_index_chunks USING COVERING INDEX idx_memory_index_chunks_source
SCALAR SUBQUERY 2
SCAN memory_index_chunks_fts_docsize
```

### chunk_keyword: before has 1 distinct SQL text(s), after has 1; plans identical in order: true

before [daab333f84d9] #1:
```
SCAN memory_index_chunks_fts VIRTUAL TABLE INDEX 32:rM7
SEARCH c EXISTS USING COVERING INDEX sqlite_autoindex_memory_index_chunks_1 (id=?)
```
after [622ae0e4bf79] #1:
```
SCAN memory_index_chunks_fts VIRTUAL TABLE INDEX 32:rM7
SEARCH c EXISTS USING COVERING INDEX sqlite_autoindex_memory_index_chunks_1 (id=?)
```

### path_exact: before has 1 distinct SQL text(s), after has 1; plans identical in order: true

before [72b554327826] #1:
```
MATERIALIZE exact_paths
MATERIALIZE scored_paths
MATERIALIZE pattern_candidates
MATERIALIZE candidates
SCAN memory_index_paths_fts VIRTUAL TABLE INDEX 0:M2
SCAN candidates
SCAN pattern_candidates
SCAN scored_paths
SEARCH live EXISTS USING COVERING INDEX idx_memory_index_chunks_path_source (path=? AND source=?)
USE TEMP B-TREE FOR ORDER BY
SCAN exact_paths
SEARCH c USING INDEX sqlite_autoindex_memory_index_chunks_1 (id=?)
CORRELATED SCALAR SUBQUERY 6
SEARCH candidate USING INDEX idx_memory_index_chunks_path_source (path=? AND source=?)
USE TEMP B-TREE FOR ORDER BY
```
after [46a11f24b27e] #1:
```
MATERIALIZE exact_paths
MATERIALIZE scored_paths
MATERIALIZE pattern_candidates
MATERIALIZE candidates
SCAN memory_index_paths_fts VIRTUAL TABLE INDEX 0:M2
SCAN candidates
SCAN pattern_candidates
SCAN scored_paths
SEARCH live EXISTS USING COVERING INDEX idx_memory_index_chunks_path_source (path=? AND source=?)
USE TEMP B-TREE FOR ORDER BY
SCAN exact_paths
SEARCH c USING INDEX sqlite_autoindex_memory_index_chunks_1 (id=?)
CORRELATED SCALAR SUBQUERY 6
SEARCH candidate USING INDEX idx_memory_index_chunks_path_source (path=? AND source=?)
USE TEMP B-TREE FOR ORDER BY
```

### path_lexical: before has 2 distinct SQL text(s), after has 2; plans identical in order: true

before [7c8cf9e651bc] #1:
```
MATERIALIZE retained_paths
SCAN memory_index_paths_fts VIRTUAL TABLE INDEX 0:M2
SEARCH live EXISTS USING COVERING INDEX idx_memory_index_chunks_path_source (path=? AND source=?)
USE TEMP B-TREE FOR ORDER BY
SCAN retained_paths
SEARCH c USING INDEX sqlite_autoindex_memory_index_chunks_1 (id=?)
CORRELATED SCALAR SUBQUERY 3
SEARCH candidate USING INDEX idx_memory_index_chunks_path_source (path=? AND source=?)
USE TEMP B-TREE FOR ORDER BY
```
after [21496275f86a] #1:
```
MATERIALIZE retained_paths
SCAN memory_index_paths_fts VIRTUAL TABLE INDEX 0:M2
SEARCH live EXISTS USING COVERING INDEX idx_memory_index_chunks_path_source (path=? AND source=?)
USE TEMP B-TREE FOR ORDER BY
SCAN retained_paths
SEARCH c USING INDEX sqlite_autoindex_memory_index_chunks_1 (id=?)
CORRELATED SCALAR SUBQUERY 3
SEARCH candidate USING INDEX idx_memory_index_chunks_path_source (path=? AND source=?)
USE TEMP B-TREE FOR ORDER BY
```

before [cdf87851408a] #2:
```
MATERIALIZE retained_paths
SCAN memory_index_paths_fts VIRTUAL TABLE INDEX 0:M2
SEARCH live EXISTS USING COVERING INDEX idx_memory_index_chunks_path_source (path=? AND source=?)
USE TEMP B-TREE FOR ORDER BY
SCAN retained_paths
SEARCH c USING INDEX sqlite_autoindex_memory_index_chunks_1 (id=?)
CORRELATED SCALAR SUBQUERY 3
SEARCH candidate USING INDEX idx_memory_index_chunks_path_source (path=? AND source=?)
USE TEMP B-TREE FOR ORDER BY
```
after [21c9b5289d11] #2:
```
MATERIALIZE retained_paths
SCAN memory_index_paths_fts VIRTUAL TABLE INDEX 0:M2
SEARCH live EXISTS USING COVERING INDEX idx_memory_index_chunks_path_source (path=? AND source=?)
USE TEMP B-TREE FOR ORDER BY
SCAN retained_paths
SEARCH c USING INDEX sqlite_autoindex_memory_index_chunks_1 (id=?)
CORRELATED SCALAR SUBQUERY 3
SEARCH candidate USING INDEX idx_memory_index_chunks_path_source (path=? AND source=?)
USE TEMP B-TREE FOR ORDER BY
```

## cli search1

### reconcile_count: before has 1 distinct SQL text(s), after has 1; plans identical in order: true

before [3d5b652d4207] #1:
```
SCAN CONSTANT ROW
SCALAR SUBQUERY 1
SCAN memory_index_chunks USING COVERING INDEX idx_memory_index_chunks_source
SCALAR SUBQUERY 2
SCAN memory_index_chunks_fts_docsize
```
after [3d5b652d4207] #1:
```
SCAN CONSTANT ROW
SCALAR SUBQUERY 1
SCAN memory_index_chunks USING COVERING INDEX idx_memory_index_chunks_source
SCALAR SUBQUERY 2
SCAN memory_index_chunks_fts_docsize
```

### chunk_keyword: before has 1 distinct SQL text(s), after has 1; plans identical in order: true

before [daab333f84d9] #1:
```
SCAN memory_index_chunks_fts VIRTUAL TABLE INDEX 32:rM7
SEARCH c EXISTS USING COVERING INDEX sqlite_autoindex_memory_index_chunks_1 (id=?)
```
after [622ae0e4bf79] #1:
```
SCAN memory_index_chunks_fts VIRTUAL TABLE INDEX 32:rM7
SEARCH c EXISTS USING COVERING INDEX sqlite_autoindex_memory_index_chunks_1 (id=?)
```

### path_exact: before has 1 distinct SQL text(s), after has 1; plans identical in order: true

before [72b554327826] #1:
```
MATERIALIZE exact_paths
MATERIALIZE scored_paths
MATERIALIZE pattern_candidates
MATERIALIZE candidates
SCAN memory_index_paths_fts VIRTUAL TABLE INDEX 0:M2
SCAN candidates
SCAN pattern_candidates
SCAN scored_paths
SEARCH live EXISTS USING COVERING INDEX idx_memory_index_chunks_path_source (path=? AND source=?)
USE TEMP B-TREE FOR ORDER BY
SCAN exact_paths
SEARCH c USING INDEX sqlite_autoindex_memory_index_chunks_1 (id=?)
CORRELATED SCALAR SUBQUERY 6
SEARCH candidate USING INDEX idx_memory_index_chunks_path_source (path=? AND source=?)
USE TEMP B-TREE FOR ORDER BY
```
after [46a11f24b27e] #1:
```
MATERIALIZE exact_paths
MATERIALIZE scored_paths
MATERIALIZE pattern_candidates
MATERIALIZE candidates
SCAN memory_index_paths_fts VIRTUAL TABLE INDEX 0:M2
SCAN candidates
SCAN pattern_candidates
SCAN scored_paths
SEARCH live EXISTS USING COVERING INDEX idx_memory_index_chunks_path_source (path=? AND source=?)
USE TEMP B-TREE FOR ORDER BY
SCAN exact_paths
SEARCH c USING INDEX sqlite_autoindex_memory_index_chunks_1 (id=?)
CORRELATED SCALAR SUBQUERY 6
SEARCH candidate USING INDEX idx_memory_index_chunks_path_source (path=? AND source=?)
USE TEMP B-TREE FOR ORDER BY
```

### path_lexical: before has 2 distinct SQL text(s), after has 2; plans identical in order: true

before [7c8cf9e651bc] #1:
```
MATERIALIZE retained_paths
SCAN memory_index_paths_fts VIRTUAL TABLE INDEX 0:M2
SEARCH live EXISTS USING COVERING INDEX idx_memory_index_chunks_path_source (path=? AND source=?)
USE TEMP B-TREE FOR ORDER BY
SCAN retained_paths
SEARCH c USING INDEX sqlite_autoindex_memory_index_chunks_1 (id=?)
CORRELATED SCALAR SUBQUERY 3
SEARCH candidate USING INDEX idx_memory_index_chunks_path_source (path=? AND source=?)
USE TEMP B-TREE FOR ORDER BY
```
after [21496275f86a] #1:
```
MATERIALIZE retained_paths
SCAN memory_index_paths_fts VIRTUAL TABLE INDEX 0:M2
SEARCH live EXISTS USING COVERING INDEX idx_memory_index_chunks_path_source (path=? AND source=?)
USE TEMP B-TREE FOR ORDER BY
SCAN retained_paths
SEARCH c USING INDEX sqlite_autoindex_memory_index_chunks_1 (id=?)
CORRELATED SCALAR SUBQUERY 3
SEARCH candidate USING INDEX idx_memory_index_chunks_path_source (path=? AND source=?)
USE TEMP B-TREE FOR ORDER BY
```

before [cdf87851408a] #2:
```
MATERIALIZE retained_paths
SCAN memory_index_paths_fts VIRTUAL TABLE INDEX 0:M2
SEARCH live EXISTS USING COVERING INDEX idx_memory_index_chunks_path_source (path=? AND source=?)
USE TEMP B-TREE FOR ORDER BY
SCAN retained_paths
SEARCH c USING INDEX sqlite_autoindex_memory_index_chunks_1 (id=?)
CORRELATED SCALAR SUBQUERY 3
SEARCH candidate USING INDEX idx_memory_index_chunks_path_source (path=? AND source=?)
USE TEMP B-TREE FOR ORDER BY
```
after [21c9b5289d11] #2:
```
MATERIALIZE retained_paths
SCAN memory_index_paths_fts VIRTUAL TABLE INDEX 0:M2
SEARCH live EXISTS USING COVERING INDEX idx_memory_index_chunks_path_source (path=? AND source=?)
USE TEMP B-TREE FOR ORDER BY
SCAN retained_paths
SEARCH c USING INDEX sqlite_autoindex_memory_index_chunks_1 (id=?)
CORRELATED SCALAR SUBQUERY 3
SEARCH candidate USING INDEX idx_memory_index_chunks_path_source (path=? AND source=?)
USE TEMP B-TREE FOR ORDER BY
```

## cli search3

### reconcile_count: before has 1 distinct SQL text(s), after has 1; plans identical in order: true

before [3d5b652d4207] #1:
```
SCAN CONSTANT ROW
SCALAR SUBQUERY 1
SCAN memory_index_chunks USING COVERING INDEX idx_memory_index_chunks_source
SCALAR SUBQUERY 2
SCAN memory_index_chunks_fts_docsize
```
after [3d5b652d4207] #1:
```
SCAN CONSTANT ROW
SCALAR SUBQUERY 1
SCAN memory_index_chunks USING COVERING INDEX idx_memory_index_chunks_source
SCALAR SUBQUERY 2
SCAN memory_index_chunks_fts_docsize
```

### chunk_keyword: before has 1 distinct SQL text(s), after has 1; plans identical in order: true

before [daab333f84d9] #1:
```
SCAN memory_index_chunks_fts VIRTUAL TABLE INDEX 32:rM7
SEARCH c EXISTS USING COVERING INDEX sqlite_autoindex_memory_index_chunks_1 (id=?)
```
after [622ae0e4bf79] #1:
```
SCAN memory_index_chunks_fts VIRTUAL TABLE INDEX 32:rM7
SEARCH c EXISTS USING COVERING INDEX sqlite_autoindex_memory_index_chunks_1 (id=?)
```

### path_exact: before has 1 distinct SQL text(s), after has 1; plans identical in order: true

before [72b554327826] #1:
```
MATERIALIZE exact_paths
MATERIALIZE scored_paths
MATERIALIZE pattern_candidates
MATERIALIZE candidates
SCAN memory_index_paths_fts VIRTUAL TABLE INDEX 0:M2
SCAN candidates
SCAN pattern_candidates
SCAN scored_paths
SEARCH live EXISTS USING COVERING INDEX idx_memory_index_chunks_path_source (path=? AND source=?)
USE TEMP B-TREE FOR ORDER BY
SCAN exact_paths
SEARCH c USING INDEX sqlite_autoindex_memory_index_chunks_1 (id=?)
CORRELATED SCALAR SUBQUERY 6
SEARCH candidate USING INDEX idx_memory_index_chunks_path_source (path=? AND source=?)
USE TEMP B-TREE FOR ORDER BY
```
after [46a11f24b27e] #1:
```
MATERIALIZE exact_paths
MATERIALIZE scored_paths
MATERIALIZE pattern_candidates
MATERIALIZE candidates
SCAN memory_index_paths_fts VIRTUAL TABLE INDEX 0:M2
SCAN candidates
SCAN pattern_candidates
SCAN scored_paths
SEARCH live EXISTS USING COVERING INDEX idx_memory_index_chunks_path_source (path=? AND source=?)
USE TEMP B-TREE FOR ORDER BY
SCAN exact_paths
SEARCH c USING INDEX sqlite_autoindex_memory_index_chunks_1 (id=?)
CORRELATED SCALAR SUBQUERY 6
SEARCH candidate USING INDEX idx_memory_index_chunks_path_source (path=? AND source=?)
USE TEMP B-TREE FOR ORDER BY
```

### path_lexical: before has 2 distinct SQL text(s), after has 2; plans identical in order: true

before [7c8cf9e651bc] #1:
```
MATERIALIZE retained_paths
SCAN memory_index_paths_fts VIRTUAL TABLE INDEX 0:M2
SEARCH live EXISTS USING COVERING INDEX idx_memory_index_chunks_path_source (path=? AND source=?)
USE TEMP B-TREE FOR ORDER BY
SCAN retained_paths
SEARCH c USING INDEX sqlite_autoindex_memory_index_chunks_1 (id=?)
CORRELATED SCALAR SUBQUERY 3
SEARCH candidate USING INDEX idx_memory_index_chunks_path_source (path=? AND source=?)
USE TEMP B-TREE FOR ORDER BY
```
after [21496275f86a] #1:
```
MATERIALIZE retained_paths
SCAN memory_index_paths_fts VIRTUAL TABLE INDEX 0:M2
SEARCH live EXISTS USING COVERING INDEX idx_memory_index_chunks_path_source (path=? AND source=?)
USE TEMP B-TREE FOR ORDER BY
SCAN retained_paths
SEARCH c USING INDEX sqlite_autoindex_memory_index_chunks_1 (id=?)
CORRELATED SCALAR SUBQUERY 3
SEARCH candidate USING INDEX idx_memory_index_chunks_path_source (path=? AND source=?)
USE TEMP B-TREE FOR ORDER BY
```

before [cdf87851408a] #2:
```
MATERIALIZE retained_paths
SCAN memory_index_paths_fts VIRTUAL TABLE INDEX 0:M2
SEARCH live EXISTS USING COVERING INDEX idx_memory_index_chunks_path_source (path=? AND source=?)
USE TEMP B-TREE FOR ORDER BY
SCAN retained_paths
SEARCH c USING INDEX sqlite_autoindex_memory_index_chunks_1 (id=?)
CORRELATED SCALAR SUBQUERY 3
SEARCH candidate USING INDEX idx_memory_index_chunks_path_source (path=? AND source=?)
USE TEMP B-TREE FOR ORDER BY
```
after [21c9b5289d11] #2:
```
MATERIALIZE retained_paths
SCAN memory_index_paths_fts VIRTUAL TABLE INDEX 0:M2
SEARCH live EXISTS USING COVERING INDEX idx_memory_index_chunks_path_source (path=? AND source=?)
USE TEMP B-TREE FOR ORDER BY
SCAN retained_paths
SEARCH c USING INDEX sqlite_autoindex_memory_index_chunks_1 (id=?)
CORRELATED SCALAR SUBQUERY 3
SEARCH candidate USING INDEX idx_memory_index_chunks_path_source (path=? AND source=?)
USE TEMP B-TREE FOR ORDER BY
```


Verdict: all plans identical between arms in every source: true
