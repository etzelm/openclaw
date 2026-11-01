# Evidence: chat.history page reads in one PostgreSQL snapshot (openclaw#188956)

Change: one read-only snapshot per `chat.history` page task in the history worker, covering the Claude CLI import check and every page and tail-scan read.

## Builds

- `main` base: 6e36a0b85b4. Change: one commit on top (3 source files, one new live PostgreSQL test file).
- Gateway bench and trace builds: `ac2c420` ("live", the build that wrote the ported store) and `ac2c420` with the same change applied ("livefix"; only an import line conflicted).

## Data

A copy of a production store: the nightly `pg_dump` of a 13-schema PostgreSQL store (11 agents, about 4.6 GB), restored into a scratch PostgreSQL 17.11 on the same host over a Unix socket, with credential tables emptied. A `pg_restore` copy does not reproduce the physical catalog exactly, so the copy was adjusted before use, without changing any rows:

- one CHECK constraint that `pg_restore` re-parses into a flat AND was re-created from its schema source text;
- each schema's stored catalog fingerprint was recomputed for the restored catalog (same hashing as the product);
- the copied Gateway ownership lease was removed.

The dump-time build then boots it normally. Current `main` still refuses it during its Doctor migration, so the Gateway measurements use `ac2c420`. Memory search was disabled in the bench config.

## Files

- `tests/`: the regression test, red on base and green with the change (`red-v3.log`, `green-v3.log`: 3 and 7 read-only BEGINs for one page on base, 1 with the change). `mutant-unit.log`: without the rollback after a failed read inside the held snapshot, the error-path test fails with `25P02`. `red-ac2c420.log` and `green-ac2c420.log`: the same red/green on the bench build, from an earlier revision of the test file (two tests). `conformance-fix.log` and `conformance-base.log`: targeted live PostgreSQL conformance (counts in `SUMMARY.txt`). `unit-fix.log`: consumer unit tests of the changed modules. `check-changed.log`: the repository's changed-lanes check; the only failure is the dead-export scan on two files this change does not touch. `with-188952-*.log`: the new test, two PostgreSQL bridge suites and `connection.test.ts` on a tree that also has #188952 applied.
- `traces/`: every statement PostgreSQL logged during six sequential `chat.history` calls, three sessions, two calls each (`log_min_duration_statement = 0`), summarized per call. Session keys are replaced.
- `attribution/snapshot-attribution.txt`: where each read-only snapshot of one call opens (stack printed at every `BEGIN ... READ ONLY` in a debug copy of the earlier revision), plus the Gateway diagnostics timeline spans for one call.
- `bench/`: closed-loop `chat.history`-only runs, three interleaved runs per build (order live, livefix, livefix, live, live, livefix). Each run uses a fresh database from one template and a fresh home, a priming boot, Prometheus diagnostics on, and a 20 s warmup, then three arms: `h1` (200 sampled sessions, concurrency 1, 45 s), `h8` (same, concurrency 8, 45 s), and `d1` (sessions of one agent only, concurrency 1, 20 s; isolates schema switching). `table.tsv` has one row per run and arm, with the 1-minute load average at arm start and end. `medians.tsv` has the median of three runs. `runs/<run>/` has the driver summary (`<arm>.json`), `pg_stat_statements` reset per arm (`<arm>.pgss.tsv`), and Prometheus scrapes before and after each arm.
- `scripts/`: the harness (bench driver, run and round scripts, analysis, restore and seal adjustments, conformance runner). Session lists are not included.

## Metric definitions

- Statements, read-only transactions and `set_config` per call: `pg_stat_statements` calls divided by successful `chat.history` calls in the arm.
- Worker requests per call and queue wait per request: deltas of `openclaw_worker_queue_wait_seconds{kind="sessionTranscript"}` count and sum.
- p50/p95/p99: driver-side latency per call.

## Host

A shared 32-thread Mac Studio. Final runs had a 1-minute load average of 4.9 to 9.0. Other tenants were active earlier in the session.
