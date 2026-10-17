# Reply lookup BEFORE/AFTER (production path)

All numbers are quoted from the measure-<arm>-r<N>.out files in this directory. Each cell: median ms of a 200-lookup sample (5 timed samples, 2 warm-ups); the 5 raw samples are in the .out files.

## Load readings (uptime before/after each run, from the .out files)

| run | before | after |
|---|---|---|
| BEFORE r1 | 21:31  up 4 days, 13:31, 1 user, load averages: 9.98 18.17 28.24 | 21:39  up 4 days, 13:39, 1 user, load averages: 4.66 7.14 18.29 |
| AFTER r1 | 21:39  up 4 days, 13:39, 1 user, load averages: 4.66 7.14 18.29 | 21:41  up 4 days, 13:41, 1 user, load averages: 16.39 9.56 17.50 |
| AFTER r2 | 21:43  up 4 days, 13:43, 1 user, load averages: 9.88 9.52 16.46 | 21:45  up 4 days, 13:45, 1 user, load averages: 6.47 8.42 14.97 |
| BEFORE r2 | 22:09  up 4 days, 14:09, 1 user, load averages: 1.97 8.72 18.09 | 22:16  up 4 days, 14:17, 1 user, load averages: 16.51 11.47 15.04 |

## Store a: 200,000 rows over 50 conversations, synthetic mix with turn rows

| phase | case | BEFORE r1 | AFTER r1 | AFTER r2 | BEFORE r2 | hash B1/A1/A2/B2 | hashes equal | r1 vs r2 spread |
|---|---|---|---|---|---|---|---|---|
| no ANALYZE | miss | 6765.907 | 57.898 | 57.814 | 6196.932 | 7598d56576ac2c0d / 7598d56576ac2c0d / 7598d56576ac2c0d / 7598d56576ac2c0d | yes | BEFORE 9.2%; AFTER 0.1% |
| no ANALYZE | hit, newest turn row | 9.272 | 58.775 | 58.071 | 10.189 | b39b0f0c8588f22c / b39b0f0c8588f22c / b39b0f0c8588f22c / b39b0f0c8588f22c | yes | BEFORE 9.9%; AFTER 1.2% |
| no ANALYZE | hit, oldest turn row | 6806.746 | 60.336 | 58.856 | 6416.2 | b239a888beab8eee / b239a888beab8eee / b239a888beab8eee / b239a888beab8eee | yes | BEFORE 6.1%; AFTER 2.5% |
| after ANALYZE | miss | 7135.775 | 57.873 | 118.11 | 6937.923 | 7598d56576ac2c0d / 7598d56576ac2c0d / 7598d56576ac2c0d / 7598d56576ac2c0d | yes | BEFORE 2.9%; AFTER 104.1% (>10%) |
| after ANALYZE | hit, newest turn row | 10.024 | 59.674 | 125.585 | 10.696 | b39b0f0c8588f22c / b39b0f0c8588f22c / b39b0f0c8588f22c / b39b0f0c8588f22c | yes | BEFORE 6.7%; AFTER 110.5% (>10%) |
| after ANALYZE | hit, oldest turn row | 6883.977 | 59.959 | 61.96 | 7817.323 | b239a888beab8eee / b239a888beab8eee / b239a888beab8eee / b239a888beab8eee | yes | BEFORE 13.6% (>10%); AFTER 3.3% |

### EXPLAIN QUERY PLAN of the captured production SQL (store a)

- BEFORE / no ANALYZE / miss: SEARCH conversation USING INDEX sqlite_autoindex_conversations_1 (conversation_id=?) ; SCAN delivery USING INDEX idx_agent_conversation_deliveries_updated
- AFTER / no ANALYZE / miss: SEARCH conversation USING INDEX sqlite_autoindex_conversations_1 (conversation_id=?) ; SEARCH delivery USING INDEX idx_agent_conversation_deliveries_reply (conversation_id=?) ; USE TEMP B-TREE FOR ORDER BY
- BEFORE / no ANALYZE / hit, newest turn row: SEARCH conversation USING INDEX sqlite_autoindex_conversations_1 (conversation_id=?) ; SCAN delivery USING INDEX idx_agent_conversation_deliveries_updated
- AFTER / no ANALYZE / hit, newest turn row: SEARCH conversation USING INDEX sqlite_autoindex_conversations_1 (conversation_id=?) ; SEARCH delivery USING INDEX idx_agent_conversation_deliveries_reply (conversation_id=?) ; USE TEMP B-TREE FOR ORDER BY
- BEFORE / no ANALYZE / hit, oldest turn row: SEARCH conversation USING INDEX sqlite_autoindex_conversations_1 (conversation_id=?) ; SCAN delivery USING INDEX idx_agent_conversation_deliveries_updated
- AFTER / no ANALYZE / hit, oldest turn row: SEARCH conversation USING INDEX sqlite_autoindex_conversations_1 (conversation_id=?) ; SEARCH delivery USING INDEX idx_agent_conversation_deliveries_reply (conversation_id=?) ; USE TEMP B-TREE FOR ORDER BY
- BEFORE / after ANALYZE / miss: SEARCH conversation USING INDEX sqlite_autoindex_conversations_1 (conversation_id=?) ; SCAN delivery USING INDEX idx_agent_conversation_deliveries_updated
- AFTER / after ANALYZE / miss: SEARCH conversation USING INDEX sqlite_autoindex_conversations_1 (conversation_id=?) ; SEARCH delivery USING INDEX idx_agent_conversation_deliveries_reply (conversation_id=?) ; USE TEMP B-TREE FOR ORDER BY
- BEFORE / after ANALYZE / hit, newest turn row: SEARCH conversation USING INDEX sqlite_autoindex_conversations_1 (conversation_id=?) ; SCAN delivery USING INDEX idx_agent_conversation_deliveries_updated
- AFTER / after ANALYZE / hit, newest turn row: SEARCH conversation USING INDEX sqlite_autoindex_conversations_1 (conversation_id=?) ; SEARCH delivery USING INDEX idx_agent_conversation_deliveries_reply (conversation_id=?) ; USE TEMP B-TREE FOR ORDER BY
- BEFORE / after ANALYZE / hit, oldest turn row: SEARCH conversation USING INDEX sqlite_autoindex_conversations_1 (conversation_id=?) ; SCAN delivery USING INDEX idx_agent_conversation_deliveries_updated
- AFTER / after ANALYZE / hit, oldest turn row: SEARCH conversation USING INDEX sqlite_autoindex_conversations_1 (conversation_id=?) ; SEARCH delivery USING INDEX idx_agent_conversation_deliveries_reply (conversation_id=?) ; USE TEMP B-TREE FOR ORDER BY

## Store b: 200,000 rows in 1 conversation, synthetic mix with turn rows

| phase | case | BEFORE r1 | AFTER r1 | AFTER r2 | BEFORE r2 | hash B1/A1/A2/B2 | hashes equal | r1 vs r2 spread |
|---|---|---|---|---|---|---|---|---|
| no ANALYZE | miss | 7661.396 | 2104.302 | 2167.453 | 8265.693 | 7598d56576ac2c0d / 7598d56576ac2c0d / 7598d56576ac2c0d / 7598d56576ac2c0d | yes | BEFORE 7.9%; AFTER 3.0% |
| no ANALYZE | hit, newest turn row | 11.492 | 2053.875 | 2157.32 | 9.659 | 00721dde23dd530a / 00721dde23dd530a / 00721dde23dd530a / 00721dde23dd530a | yes | BEFORE 19.0% (>10%); AFTER 5.0% |
| no ANALYZE | hit, oldest turn row | 8175.404 | 2225.747 | 2225.293 | 8481.765 | 12a5de9f4a2dc8d9 / 12a5de9f4a2dc8d9 / 12a5de9f4a2dc8d9 / 12a5de9f4a2dc8d9 | yes | BEFORE 3.7%; AFTER 0.0% |
| after ANALYZE | miss | 2604.635 | 2130.611 | 2145.433 | 3327.742 | 7598d56576ac2c0d / 7598d56576ac2c0d / 7598d56576ac2c0d / 7598d56576ac2c0d | yes | BEFORE 27.8% (>10%); AFTER 0.7% |
| after ANALYZE | hit, newest turn row | 2569.122 | 2170.979 | 2128.977 | 3343.634 | 00721dde23dd530a / 00721dde23dd530a / 00721dde23dd530a / 00721dde23dd530a | yes | BEFORE 30.1% (>10%); AFTER 2.0% |
| after ANALYZE | hit, oldest turn row | 2578.913 | 2146.914 | 2240.333 | 3262.987 | 12a5de9f4a2dc8d9 / 12a5de9f4a2dc8d9 / 12a5de9f4a2dc8d9 / 12a5de9f4a2dc8d9 | yes | BEFORE 26.5% (>10%); AFTER 4.4% |

### EXPLAIN QUERY PLAN of the captured production SQL (store b)

- BEFORE / no ANALYZE / miss: SEARCH conversation USING INDEX sqlite_autoindex_conversations_1 (conversation_id=?) ; SCAN delivery USING INDEX idx_agent_conversation_deliveries_updated
- AFTER / no ANALYZE / miss: SEARCH conversation USING INDEX sqlite_autoindex_conversations_1 (conversation_id=?) ; SEARCH delivery USING INDEX idx_agent_conversation_deliveries_reply (conversation_id=?) ; USE TEMP B-TREE FOR ORDER BY
- BEFORE / no ANALYZE / hit, newest turn row: SEARCH conversation USING INDEX sqlite_autoindex_conversations_1 (conversation_id=?) ; SCAN delivery USING INDEX idx_agent_conversation_deliveries_updated
- AFTER / no ANALYZE / hit, newest turn row: SEARCH conversation USING INDEX sqlite_autoindex_conversations_1 (conversation_id=?) ; SEARCH delivery USING INDEX idx_agent_conversation_deliveries_reply (conversation_id=?) ; USE TEMP B-TREE FOR ORDER BY
- BEFORE / no ANALYZE / hit, oldest turn row: SEARCH conversation USING INDEX sqlite_autoindex_conversations_1 (conversation_id=?) ; SCAN delivery USING INDEX idx_agent_conversation_deliveries_updated
- AFTER / no ANALYZE / hit, oldest turn row: SEARCH conversation USING INDEX sqlite_autoindex_conversations_1 (conversation_id=?) ; SEARCH delivery USING INDEX idx_agent_conversation_deliveries_reply (conversation_id=?) ; USE TEMP B-TREE FOR ORDER BY
- BEFORE / after ANALYZE / miss: SCAN conversation ; SCAN delivery ; USE TEMP B-TREE FOR ORDER BY
- AFTER / after ANALYZE / miss: SCAN conversation ; SEARCH delivery USING INDEX idx_agent_conversation_deliveries_reply (conversation_id=?) ; USE TEMP B-TREE FOR ORDER BY
- BEFORE / after ANALYZE / hit, newest turn row: SCAN conversation ; SCAN delivery ; USE TEMP B-TREE FOR ORDER BY
- AFTER / after ANALYZE / hit, newest turn row: SCAN conversation ; SEARCH delivery USING INDEX idx_agent_conversation_deliveries_reply (conversation_id=?) ; USE TEMP B-TREE FOR ORDER BY
- BEFORE / after ANALYZE / hit, oldest turn row: SCAN conversation ; SCAN delivery ; USE TEMP B-TREE FOR ORDER BY
- AFTER / after ANALYZE / hit, oldest turn row: SCAN conversation ; SEARCH delivery USING INDEX idx_agent_conversation_deliveries_reply (conversation_id=?) ; USE TEMP B-TREE FOR ORDER BY

## Store c: 666 rows over 50 conversations, observed mix (643 sent, 23 unknown, no turn rows)

| phase | case | BEFORE r1 | AFTER r1 | AFTER r2 | BEFORE r2 | hash B1/A1/A2/B2 | hashes equal | r1 vs r2 spread |
|---|---|---|---|---|---|---|---|---|
| no ANALYZE | miss | 21.532 | 9.004 | 9.264 | 22.441 | 7598d56576ac2c0d / 7598d56576ac2c0d / 7598d56576ac2c0d / 7598d56576ac2c0d | yes | BEFORE 4.2%; AFTER 2.9% |
| after ANALYZE | miss | 20.934 | 10.832 | 9.075 | 22.531 | 7598d56576ac2c0d / 7598d56576ac2c0d / 7598d56576ac2c0d / 7598d56576ac2c0d | yes | BEFORE 7.6%; AFTER 19.4% (>10%) |

### EXPLAIN QUERY PLAN of the captured production SQL (store c)

- BEFORE / no ANALYZE / miss: SEARCH conversation USING INDEX sqlite_autoindex_conversations_1 (conversation_id=?) ; SCAN delivery USING INDEX idx_agent_conversation_deliveries_updated
- AFTER / no ANALYZE / miss: SEARCH conversation USING INDEX sqlite_autoindex_conversations_1 (conversation_id=?) ; SEARCH delivery USING INDEX idx_agent_conversation_deliveries_reply (conversation_id=?) ; USE TEMP B-TREE FOR ORDER BY
- BEFORE / after ANALYZE / miss: SEARCH conversation USING INDEX sqlite_autoindex_conversations_1 (conversation_id=?) ; SCAN delivery USING INDEX idx_agent_conversation_deliveries_updated
- AFTER / after ANALYZE / miss: SEARCH conversation USING INDEX sqlite_autoindex_conversations_1 (conversation_id=?) ; SEARCH delivery USING INDEX idx_agent_conversation_deliveries_reply (conversation_id=?) ; USE TEMP B-TREE FOR ORDER BY

## Store d: 666 rows in 1 conversation, observed mix (643 sent, 23 unknown, no turn rows)

| phase | case | BEFORE r1 | AFTER r1 | AFTER r2 | BEFORE r2 | hash B1/A1/A2/B2 | hashes equal | r1 vs r2 spread |
|---|---|---|---|---|---|---|---|---|
| no ANALYZE | miss | 22.928 | 17.225 | 16.918 | 30.032 | 7598d56576ac2c0d / 7598d56576ac2c0d / 7598d56576ac2c0d / 7598d56576ac2c0d | yes | BEFORE 31.0% (>10%); AFTER 1.8% |
| after ANALYZE | miss | 13.764 | 18.922 | 15.244 | 14.69 | 7598d56576ac2c0d / 7598d56576ac2c0d / 7598d56576ac2c0d / 7598d56576ac2c0d | yes | BEFORE 6.7%; AFTER 24.1% (>10%) |

### EXPLAIN QUERY PLAN of the captured production SQL (store d)

- BEFORE / no ANALYZE / miss: SEARCH conversation USING INDEX sqlite_autoindex_conversations_1 (conversation_id=?) ; SCAN delivery USING INDEX idx_agent_conversation_deliveries_updated
- AFTER / no ANALYZE / miss: SEARCH conversation USING INDEX sqlite_autoindex_conversations_1 (conversation_id=?) ; SEARCH delivery USING INDEX idx_agent_conversation_deliveries_reply (conversation_id=?) ; USE TEMP B-TREE FOR ORDER BY
- BEFORE / after ANALYZE / miss: SCAN conversation ; SCAN delivery ; USE TEMP B-TREE FOR ORDER BY
- AFTER / after ANALYZE / miss: SCAN conversation ; SCAN delivery ; USE TEMP B-TREE FOR ORDER BY

## Store e: real store (APFS-cloned copy of the master backup, opened directly with node:sqlite because the production opener refuses this copy (schema version 24, migration pending); see the .out lines)

| phase | case | BEFORE r1 | AFTER r1 | AFTER r2 | BEFORE r2 | hash B1/A1/A2/B2 | hashes equal | r1 vs r2 spread |
|---|---|---|---|---|---|---|---|---|
| as-is | miss (no deliveries) | 12.601 | 12.73 | 12.33 | 12.475 | 7598d56576ac2c0d / 7598d56576ac2c0d / 7598d56576ac2c0d / 7598d56576ac2c0d | yes | BEFORE 1.0%; AFTER 3.2% |

### EXPLAIN QUERY PLAN of the captured production SQL (store e)

- BEFORE / as-is / miss (no deliveries): SEARCH conversation USING INDEX sqlite_autoindex_conversations_1 (conversation_id=?) ; SCAN delivery USING INDEX idx_agent_conversation_deliveries_updated
- AFTER / as-is / miss (no deliveries): SEARCH delivery USING INDEX idx_agent_conversation_deliveries_reply (conversation_id=?) ; SEARCH conversation USING INDEX sqlite_autoindex_conversations_1 (conversation_id=?) ; USE TEMP B-TREE FOR ORDER BY
