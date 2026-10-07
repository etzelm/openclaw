# Measured test cost

`pnpm test <file> --maxWorkers=1`, one worker, on the Studio. Head rows come from
`gates.log` (head `f6038b3097c`); base rows from `evidence-run.log`, taken in the same
sitting with `extensions/memory-wiki` restored to `origin/main` (`8e667761db3`). `real` is
the wall time of the whole `pnpm test` invocation; `Duration` is vitest's own figure. All
files run in the `extension-memory` vitest project of the bundled plugin lane, which ran
them together in 126.21 s (48 files, 508 passed, 1 skipped).

| File | Tests (head) | vitest Duration, base | `real`, base | vitest Duration, head | `real`, head |
|---|---|---|---|---|---|
| `extensions/memory-wiki/src/query.reads.test.ts` | 15 | 8.46 s (16 tests on main) | 10.63 s | 25.80 s | 27.69 s |
| `extensions/memory-wiki/src/query-reader.test.ts` | 13 | not on main | | 9.72 s | 11.84 s |
| `extensions/memory-wiki/src/query.abort.test.ts` | 2 | not loadable on main | | 6.30 s | 8.43 s |
| `extensions/memory-wiki/index.test.ts` | 10 | not timed (tests unchanged) | | 6.78 s | 8.94 s |
| `extensions/memory-wiki/src/query.test.ts` | 65 | 23.68 s | 26.30 s | 12.39 s | 14.53 s |
| `extensions/memory-wiki/src/apply.test.ts` | 9 | 7.42 s | 9.54 s | 8.20 s | 10.36 s |

Two figures are transform-cache artifacts, reported as measured: the head
`query.reads.test.ts` run (25.80 s, `transform 83%`) was the first vitest invocation after a
fresh `pnpm install`, and the base `query.test.ts` run (23.68 s, `transform 71%`) was the
first invocation after the plugin was restored to the base; the same files measured 8.71 s
and 12.35 s in earlier warm runs on this machine. The files that reach the reader sit above
the 5 s target because each pool creation spawns the worker from TypeScript source through
tsx (about 1 s), and `query-reader.test.ts` retires and recreates the worker on purpose. In a
built checkout the worker loads `dist/` JavaScript. CI seconds are pending the first CI run
of this branch.
