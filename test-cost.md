# Measured test cost

Command per file: `pnpm test <file> --maxWorkers=1`, run once untimed to warm vitest's transform cache, then once timed with `/usr/bin/time -p` (`real`, `user`). Head `492827c8100fcb88a9f88e7c565311c798cfa65a` on base `origin/main` `8e667761db3e749252a770d0c31006c436ec4b26`. Raw lines: `evidence-run.log` under "HEAD test cost". Machine: Mac Studio, darwin arm64, 32 cores, Node v24.21.0, under the background load recorded per phase in `load-during-capture.txt` (a local model server and a Docker VM were running), so every number is a loaded-machine figure.

| File | Tests | vitest Duration | wall (`real`) | `user` |
|---|---|---|---|---|
| `src/query-reader.test.ts` | 13 | 13.68 s | 16.79 s | 17.29 s |
| `src/query-scheduling.test.ts` (new) | 3 | 11.66 s | 14.62 s | see `evidence-run.log` |
| `src/query.reads.test.ts` | 15 (base 16: the distributed-token candidate test moved to `query-reader.test.ts`, the basename case of the swap test was dropped, the regression test was added) | 12.02 s | 15.05 s | see `evidence-run.log` |
| `src/query.abort.test.ts` | 2 (base 1) | 9.37 s | 12.28 s | see `evidence-run.log` |
| `src/tool.deadline.test.ts` | 3 (unchanged) | 8.93 s | 11.98 s | see `evidence-run.log` |

Not measured in this sitting: base timings (the first draft's sitting measured the unchanged files within one second of their base durations under a comparable load) and CI seconds (no CI run of this head yet). The scheduling tests each write a 400-page vault so that a scan lasts long enough to be observed, and the reader tests retire and respawn workers on purpose; under vitest each spawn loads the plugin graph through tsx in a new thread.
