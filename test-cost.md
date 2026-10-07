# Measured test cost

Command per file: `pnpm test <file> --maxWorkers=1`, run once untimed to warm vitest's transform cache, then once timed with `/usr/bin/time -p` (`real`, `user`). Base is `origin/main` `8e667761db3e749252a770d0c31006c436ec4b26` with `extensions/memory-wiki` restored to it in the same checkout; head is `ed494bdcddfb55014c88a9200791d769d8e62a8f`. Raw lines: `evidence-run.log` under "BASE test cost" and "HEAD test cost". Machine: Mac Studio, darwin arm64, Node v24.21.0, under the background load recorded in `load-during-capture.txt` (load average 13 to 16), base and head in the same sitting.

| File | Tests (head) | vitest Duration, base | wall (real), base | vitest Duration, head | wall (real), head |
|---|---|---|---|---|---|
| `src/query.test.ts` | 65 | 15.66 s | 19.08 s | 16.49 s | 20.13 s |
| `src/query.reads.test.ts` | 15 (base 16: two vacuous spy assertions folded into the regression test) | 12.51 s | 15.07 s | 13.72 s | 17.07 s |
| `src/query-reader.test.ts` (new) | 13 | no file | no file | 14.66 s | 17.99 s |
| `src/query.abort.test.ts` | 2 (base 1) | not timed at base (one test, unchanged) |  | 10.65 s | 14.06 s |
| `src/apply.test.ts` | 9 | 11.52 s | 14.81 s | 12.58 s | 15.75 s |
| `index.test.ts` | 10 (base 9) | 7.34 s | 9.46 s | 10.45 s | 13.59 s |

Not measured: CI seconds (no CI run of this branch yet); the base timing of `query.abort.test.ts` (one unchanged test on base, two at the head).
