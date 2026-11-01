# Evidence: PostgreSQL chat history reader lane sized for blocking I/O

Change: on PostgreSQL agent stores the chat history worker lane uses two workers per CPU above one, capped at four (was the shared two-worker reader cap). SQLite sizing is unchanged.

## Builds

- `base`: `main` at `31866655fd6`.
- `fix`: the same commit with this change (cap 4), built before the history-lane constructor moved into the pools module (identical sizing logic). Runs `pg-fix-r4..r6` interleaved with `pg-base-r4..r6` (label `base`), and `sqlite-fix-r2`; SQLite base runs are `sqlite-base-r1..r2`.
- `fix-v4`: the final commit; one confirmation run `pg-fixv4-r7`.
- `fix8`: an earlier revision of this change with a cap of eight (same code, constant 8). Runs `pg-fix8-r1..r3`, `sqlite-fix8-r1`; interleaved with `pg-base-r1..r3` (label `base-a`).
- `base-idle` / `fix-idle`: one pair (`pg-base-idle-r1`, `pg-fix-idle-r1`) with only the 16-client arm and idle observation to 300 s, for memory. Its latency is not reported (load 9 to 12).
- `fix4`: the `fix8` build with only the cap constant changed to four in its compiled output (checked before the source change). Runs `pg-fix4-r1..r3`; `pg-fix4-r1` ran while Spotlight indexed the copied build (1-minute load 19 to 28, see its `run.json`).
- Measurement-only edit, applied identically to every build (`scripts/instrument-*.diff`, one line): the 30 s diagnostic heartbeat always publishes its memory sample. Without it, memory samples (worker counts and per-script heap) are only published after agent-lane or session-state activity, which read-only RPC load does not produce.

## Host and store

- Mac Studio, 32 threads, macOS, Node 24.22.2, PostgreSQL 17 on a Unix socket on the same host (`max_connections` 200). The host is shared; every arm records its 1-minute load average at start and end.
- Synthetic store written through the Gateway's own RPCs on the base build (`seed/`): 170 sessions in 6 agents created with `sessions.create` and filled with `chat.inject` (55,191 assistant messages, 54 MB of text, tiers tiny/medium/large/huge, `seed/plan-summary.json`), plus 30 Claude CLI sessions imported with `sessions.catalog.import` (30,582 transcript rows, tool calls and results hidden between visible turns). PostgreSQL and SQLite stores use the same plan. Each run starts from a fresh copy of the seeded database and home.

## Method

- One Gateway boot per run (`scripts/runL3d.py`), Prometheus plugin on. 20 s warmup at concurrency 4, then closed-loop `chat.history` (limit 100, uniform over the 200 sessions) at concurrency 1, 8 and 16 for 45 s each (`scripts/driver.mjs`). Then idle scrapes 10 s, 45 s and 100 s after the last arm.
- PostgreSQL runs alternate base/fix as ABBAAB (`scripts/rounds*.sh`).
- Per arm: latency percentiles from the driver; `openclaw_worker_queue_wait_seconds{kind="sessionTranscript"}` and `openclaw_gateway_rpc_handler_seconds{method="chat.history"}` deltas from the before/after scrapes. Every 2 s: Prometheus worker metrics and the `pg_stat_activity` backend count for the runtime role (`timeline.txt`), and Gateway process RSS (`samples.csv`, threads included).
- `openclaw_worker_count` / `openclaw_worker_heap_used_bytes` for `session-transcript.worker.js` cover every transcript lane (history, search, projection and others), not only history.

## Files

- `bench/medians.tsv`: per build/engine/arm medians over runs (p50/p95/p99, rps, queue wait per worker request, handler mean, peak RSS, peak backends, peak transcript isolates, load). `bench/arms.tsv`: every run and arm.
- `bench/memory-medians.tsv`, `bench/memory.tsv`: RSS before load, peak under load, and 10/45/100 s after; transcript isolate count and heap at peak and idle; backends before, peak and idle.
- `bench/runs/<run>/`: raw driver results (`*.calls.tsv.gz` per call), Prometheus scrapes, `timeline.txt`, `samples.csv`, `run.json`.
- `tests/`: `unit-red.log` (new tests on base), `unit-final.log` (new tests and consumer suites on the final commit), `check-changed.log` and `format-v4.log` (final commit).
- `scripts/`, `seed/`: everything used to seed, run and analyze.
