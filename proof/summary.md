# Summary: PR search-prepare real behavior proof (shipped CLI + real `gateway run`)

BEFORE = base a7e31844f2edcc6a0a783549f1f5c1394ec83fb8 (`t1-01-search-prepare-main`), AFTER = 1e4ab3159514a72e77e53dab106e605b0680b98d (`t1-01-search-prepare`), both built with `pnpm build` (exit 0, `build.out`), clean `git status`. Mac Studio, Node v24.21.0, SQLite 3.53.4 (`env.out`). Synthetic workspace 400 files x 24 paragraphs, byte-identical in both arms (manifest sha256 `synthetic/<arm>/logs/workspace-manifest.sha256`), indexed with `memory index --force --agent main --verbose`: 401 files, 3626 chunks in both arms (`synthetic/<arm>/logs/status.out`). `memory.search.provider: none` (keyword only). Host 1-minute load average was 21.40 to 57.81 across the proof session and 21.40 to 30.85 during the four timing runs (section D) (`uptime` in each `*.uptime` / `uptime-start.txt` / `uptime-end.txt`), so wall-clock numbers are noisy.

Observer: `tools/observe-search-prepare.mjs` (read-only; method in `notes.md`). Definitions: a *compile* is a SQLite compile episode (a prepare, or a re-prepare inside a statement run) of a search statement during which the counting authorizer saw SQLITE_READ on table `memory_index_chunks`; *auth callbacks* is the total number of authorizer callbacks in those episodes; *fn regs* is the number of `db.function` calls for the two `openclaw_memory_*` SQL functions; *prepares* is the number of `DatabaseSync.prepare` calls on search statements (cache hits do not prepare).

## C. Gateway, counting observer (30 `memory.search` calls cycling 5 queries)

Source: `gateway/<arm>/c1/gateway.obs.jsonl`, windows from `gateway/<arm>/c1/calls.jsonl`, tables built by `tools/summarize.mjs` (full per-request tables in `summary-tables.md`).

| arm | fn regs, req 1 | fn regs, req 2-30 each | fn regs total (whole run) | search prepares, req 1 / 2 / 3-30 | compiles, req 1 / 2 / 3-30 each | compiles, 30 requests | auth callbacks, req 3-30 each | auth callbacks, 30 requests |
|---|---|---|---|---|---|---|---|---|
| before | 3 | 3 | 90 | 4 / 4 / 0 | 8 / 8 / 4 | 128 | 147 | 4644 |
| after | 2 | 0 | 2 | 4 / 4 / 0 | 4 / 4 / 0 | 8 | 5 | 409 |

Reading: BEFORE re-registers the SQL functions on every request (3 `db.function` calls per request, 90 total) and recompiles all 4 search statements on every run (4 compiles per request, 128 over 30 requests; prepare is cached after request 2 yet the compile still happens inside the run). AFTER registers the 2 functions once (request 1, 2 total) and, once the statement cache has admitted the statements (they are prepared again on request 2, the second use), has 0 compiles in requests 3-30 (8 compiles total, all in requests 1-2). One residual re-prepare per request remains in AFTER (the `chunk_keyword` statement, 5 authorizer callbacks, reading only `memory_index_chunks_fts`, no `memory_index_chunks`): it is counted in `episodes` but not in `compiles`; it is FTS5's per-query sorter statement for `ORDER BY rank` (control: `../fts5/fts5-sorter-control.out`; see `notes.md`).

Residual/other episodes per request (all search episodes, requests 3-30): before: 4 episodes, 147 callbacks per request; after: 1 episodes, 5 callbacks per request; 

## B. CLI `memory search ... --json --agent main --max-results 25` (each a new process, counting observer)

Source: `synthetic/<arm>/logs/cli-search<N>.{cmd,out,err,exit,ms,obs.jsonl}`. All 10 runs exit 0 and return 25 results. A one-shot process runs every statement once, so reuse cannot show here; the table shows what one cold process does.

| arm | query | exit | wall ms | fn regs | search prepares | compile episodes in run | compiles (READ memory_index_chunks, prepare+run) | auth callbacks | search-statement run us (sum) |
|---|---|---|---|---|---|---|---|---|---|
| before | saffron glacier orchard | 0 | 8337.5 | 3 | 4 | 4 | 8 | 270 | 5281 |
| before | lorem ipsum | 0 | 6163.9 | 3 | 4 | 4 | 8 | 270 | 3821 |
| before | copper willow | 0 | 7355.0 | 3 | 4 | 4 | 8 | 270 | 3716 |
| before | harbor lantern meadow | 0 | 6184.5 | 3 | 4 | 4 | 8 | 270 | 4291 |
| before | cobalt ember tundra | 0 | 6475.7 | 3 | 4 | 4 | 8 | 270 | 5641 |
| after | saffron glacier orchard | 0 | 6460.9 | 2 | 4 | 2 | 4 | 153 | 4734 |
| after | lorem ipsum | 0 | 8085.9 | 2 | 4 | 2 | 4 | 153 | 3702 |
| after | copper willow | 0 | 7122.9 | 2 | 4 | 2 | 4 | 153 | 4120 |
| after | harbor lantern meadow | 0 | 6979.0 | 2 | 4 | 2 | 4 | 153 | 4453 |
| after | cobalt ember tundra | 0 | 4683.0 | 2 | 4 | 2 | 4 | 153 | 3844 |

In the one-shot CLI, BEFORE has compile episodes inside the first run of each statement (in addition to the prepare compile); AFTER has none that read `memory_index_chunks` inside a run, i.e. the prepare compile is the only full compile. Example BEFORE record: `synthetic/before/logs/cli-search1.obs.jsonl` (episodes with `where: run`, `readChunks` 1 and 14), AFTER: same file under `after` (`readChunks: 0` for `where: run`).

## D. Gateway, timing-only observer (no authorizer, no EQP), summed search-statement run microseconds per request

Order: before/t1, after/t1, after/t2, before/t2 (gateway restarted each time; ports 18801 before, 18802 after). Source: `gateway/<arm>/<run>/gateway.obs.jsonl` + `calls.jsonl`; start loads in `gateway/<arm>/<run>/uptime-start.txt`.

| run | median req 11-30 (us) | median req 1-10 (us) | mean 11-30 (us) | fn regs total | prepares 11-30 | raw (30 values, us) |
|---|---|---|---|---|---|---|
| before/t1 | 4047.6 | 4079.8 | 4233.5 | 90 | 0 | 4058.9 3733.1 4217.2 4360.9 4611.6 4220.2 4011.9 4029.3 4054.2 4100.7 4344 3881 3904.8 4031.3 4119.2 3925.3 3788.8 3526.4 8117 4183.1 4063.9 4057.5 3977.7 4320.1 4243.3 3986 3638.7 4216.6 4037.7 4308.2 |
| before/t2 | 4085.7 | 7218.2 | 4099.6 | 90 | 0 | 31965.6 20595.2 16898.5 11957.7 9969 4359.5 4467.4 4168.7 4144.2 4200.5 4222.3 3857.4 4096.1 4291.5 4159.3 4119.9 4043.3 4216.1 4117.8 4489.8 4199.4 4044.5 3924.2 4049.8 4024.2 3989.6 3839.8 3946.4 4075.3 4286 |
| after/t1 | 3922.1 | 3859.8 | 3972.4 | 2 | 0 | 3556.7 3769 3906 4208.8 4164 3620 3598.6 3813.5 3928 3935.1 5907.8 3936.2 3733.9 4015.8 3973.7 4001.9 3517.7 3832.5 3908 4001.3 3855.2 3835.9 3475.3 4086.8 4038.5 3804.1 3792.5 3599.6 3955.9 4176.4 |
| after/t2 | 3772.8 | 3911.3 | 3784.1 | 2 | 0 | 6049.4 3911.7 3977.8 3970.6 4082.5 3855.2 3760.9 3910.9 3825.6 3792.7 3815.9 3838.1 3681.1 4015.3 3764.3 3801 3684.1 3627.8 3833.9 3811.7 3726.6 3669 3733.7 4059.1 3728.2 3709.9 3641.4 3781.2 3872.8 3887.9 |

Per arm, median of the two per-run medians (requests 11-30): before 4047.6 and 4085.7 (mean 4066.7) us; after 3922.1 and 3772.8 (mean 3847.4) us; 

Gateway's own `memory.search` latency lines (ms resolution, each logged twice) are in `gateway-latency.md`: medians of 22 to 24 ms in all runs, a 1 ms scale difference at best; the resolution and the host load make it unable to show a change of this size, and the summed statement time (~4 ms of ~23 ms) is the more direct number.

## E. Parity

See `parity.md`: result hashes for all 5 queries are equal across both arms, across all 6 gateway runs and the CLI runs.

## F. Plans

See `plans.md`: EXPLAIN QUERY PLAN output is identical between arms for every statement shape (gateway and CLI sources).

## Not done

The optional real-store repeat was not run.
