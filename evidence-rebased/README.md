# Evidence: print each memory vector once when publishing (rebased)

Everything ran on one Mac Studio (Apple M3 Ultra, macOS 27.0.1, Node v24.21.0, SQLite 3.53.4 via node:sqlite). Local paths are replaced by placeholders: `<base>` is the clean checkout of the base `fd3a2122b95`, `<after>` the checkout of this change, `<proof>` the harness directory, `<stores>` the store copies, `<logs>` the gate log directory, `<home>` the user home.

## Layout

- `provenance.txt`: base and change heads and trees (the runs used builds of exactly these two heads), toolchain, host, store sizes and sha256, the host boot time.
- `aggregate.out`: serialization counters, timing per run and parity hashes, produced by `harness/aggregate.mjs` from `runs/`.
- `timing-paired.out`: per cell and round, median wall, process CPU and host main-thread CPU, the load range, and the paired difference of runs with the same tag (`harness/paired.mjs`).
- `runs/<arm>-<workload>-<store>-<tag>/`: one CLI run each. `transcript.txt` (commands, head, `dirty_files`, load), `summary.txt` and `summary.json` (counters per thread, statements per table, parity hashes), `snap/*.json` (counts, byte lengths and sha256 only), `logs/*.{cmd,ms,exit,rusage}` and, for timed runs, `logs/*.cpu.jsonl` (per-process main-thread CPU). `obs/*.jsonl` (observed runs only) holds the observer records: call counts and sizes, and node:sqlite statements as operation, table, row count and the first 160 characters of SQL, never parameters or row values. Runs against store copies keep no CLI stdout or stderr, because `memory status` and `memory search` output can quote stored content; runs without a store keep both.
  - Tags: `obs` observer on (counts and parity); `r<round>-<n>` observer off, timed; `r<round>-warm` warmup, not used for timing; `t1` a single observer-off run.
- `runs/measure.log`: start and end time, exit, and 1/5/15-minute load average of every run, in order (48 runs, all exit 0). Every run in `runs/` is cited; none was discarded.
- `gates/`: verbatim output of the tests and checks cited in the PR body (`RA-*` at this change, `RA-head.txt` has the head and tree they ran at; `base-max-lines.log` and `base-deadcode.log` on the clean base checkout).
- `build/`: `pnpm build` output for both arms, and `dist-probe.txt` (per arm: head at build time, `git status --porcelain` after the build, `dist/build-info.json` commit, a marker that tells the dists apart, build exits).
- `harness/`: the scripts. `measure-rebased.sh` is the driver for these runs; `run-arm.sh` runs one arm, workload and store; `oc.mjs` runs one CLI command in a clean environment (`env -i`, fresh `HOME` and `OPENCLAW_STATE_DIR`); `embed-stub.mjs` is the loopback embeddings stub; `observe-vector-serialization.mjs` is the read-only observer preload; `cpu-probe.mjs` is the CPU-only preload for timed runs; `snapshot-parity.mjs` hashes the stored rows; `gen-workload.mjs` writes the synthetic workspace; `summarize-run.mjs` writes each run's summary.

## Reading the parity hashes

Compare arms with `chunks_id_embedding`, `embedding_cache`, `vec_by_id`, and the `memory_index_chunks_vec_chunks` and `_vec_info` shadow tables. The `_vec_rowids` and `_vector_chunks00` shadow tables follow rowid assignment, which follows worker batch order, and differ between two runs of the same arm.
