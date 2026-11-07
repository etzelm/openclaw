# Evidence: PostgreSQL chat history reader lane, re-measured on current main (2026-11-07)

Change under test: on PostgreSQL agent stores the chat history worker lane uses two workers per CPU above one,
capped at four (main: the shared two-worker reader cap). SQLite sizing is unchanged.

## Builds

- `base`: `main` at `078033289a3`.
- `head`: the PR head `987348094eb1` merged into that same `main` (merge tree `439f962236f3`, no conflicts;
  local measurement build only). This is the code that would land.
- Both built with `pnpm build`. Measurement-only edit applied identically to both dists
  (`scripts/instrument-*.diff`, one line): the 30 s diagnostic heartbeat always publishes its memory sample.
  Without it, worker counts and per-script heap are only published after agent or session-state activity,
  which read-only RPC load does not produce.

## Host and store

- Mac Studio, 32 threads, macOS, Node 24.22.2, PostgreSQL 17.11 on a Unix socket on the same host
  (`bench/pg-version.txt`, settings in `scripts/setup.sh`). The host is shared with other jobs; every run
  records the 1-minute load average at start and end of each arm (`bench/block-*/arms.tsv`) and the gate
  wait (`bench/gates.txt`).
- Synthetic store written through the Gateway's own RPCs on the base build (`scripts/seed_run.py`,
  `scripts/seed.mjs`, plan in `scripts/mkplan.py`, counts in `bench/seed-plan-summary.json`): 170 sessions in
  6 agents created with `sessions.create` and filled with `chat.inject` (55,191 assistant messages, 54 MB of
  text, tiers tiny/medium/large/huge), plus 30 Claude CLI sessions imported with `sessions.catalog.import`
  (30,582 transcript rows, tool calls and results hidden between visible turns). Same plan as the earlier
  bench on this PR. Each run starts from a fresh copy of the seeded database (template) and home.

## Method

- One Gateway boot per run (`scripts/runL3d.py`), Prometheus plugin on. 20 s warmup at concurrency 4, then
  closed-loop `chat.history` (limit 100, uniform over the 200 sessions) at concurrency 1, 8, 16 and 32 for
  45 s each (`scripts/driver.mjs`). Then idle scrapes 10 s, 45 s and 100 s after the last arm.
- 16 runs, 8 per build, in two blocks interleaved as base head head base base head head base:
  - block 1 (`bench/block-b1/`, runs r1 to r4): gate "1-minute load below 32"; arms ran at 1-minute load 6 to 55.
  - block 2 (`bench/block-b2/`, runs r5 to r8): gate "1-minute load below 12"; arms ran at 1-minute load 4 to 25.
  - Two head runs, `pg-head-r2` (block 1) and `pg-head-r8` (block 2), started while another job held most host
    memory (`memory free 25%` in `bench/gates.txt`); both are kept.
  - `bench/block-all/`: medians over all 16 runs. No run was dropped.
- Per arm: latency percentiles from the driver; `openclaw_worker_queue_wait_seconds{kind="sessionTranscript"}`
  and `openclaw_gateway_rpc_handler_seconds{method="chat.history"}` deltas from the before/after scrapes. Every
  2 s: worker metrics and the `pg_stat_activity` backend count for the runtime role (`timeline.txt.gz`), and
  Gateway process RSS (`samples.csv`, threads included). Worker counts and heap for
  `session-transcript.worker.js` cover every transcript lane, not only history.

## Files

- `bench/block-*/medians.tsv`: per build and arm medians over runs (p50/p95/p99, rps, queue wait per worker
  request, handler mean, peak RSS, peak backends, load, p99 range). `arms.tsv`: every run and arm.
- `bench/block-*/memory-medians.tsv`, `memory.tsv`: RSS before, at peak and 10/45/100 s after; transcript
  isolates and heap at peak and idle; backends before, at peak and idle.
- `bench/runs/<run>/`: `run.json`, driver results per arm (`h*.json`), Prometheus scrapes (`*.prom*.gz`),
  `timeline.txt.gz`, `samples.csv`.
- `tests/unit-head.log`: the two new test files plus 10 consumer suites on the merged head (12 files, 161
  tests pass). `tests/unit-base-red.log`: the two new test files on base (sizing table 7 of 7 fail because
  the resolver does not exist; lane test: PostgreSQL case gets 2 instead of 4, SQLite case passes).
- `tests/check-changed.log`: `pnpm check:changed --base 078033289a3` on the merged head. Two broad audits fail;
  both fail identically on plain `main`: `tests/base-changelog-attr.log` (same 20 bot credit lines in
  `CHANGELOG/`) and `tests/base-deadcode.log` (same unused exports in `scripts/lib/control-ui-gesture-probe.ts`
  and `src/process/command-reservation-census.ts`). The PR touches none of those files.
- `scripts/`: everything used to set up, seed, run and analyze.
