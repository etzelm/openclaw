# Evidence for openclaw/openclaw#166304 (PR #166433)

Branch `feat/memory-wiki-worker-vault-scan`, base `8e667761db3e749252a770d0c31006c436ec4b26`
(`origin/main` after #166329 and #166355 merged), head `492827c8100fcb88a9f88e7c565311c798cfa65a`
(three commits: the worker pool, its docs note, and the scheduling follow-up that answers the
review of the first published draft `a5af25c3924b21935856b4ff9f4e0be08d071a89`).
Machine: Mac Studio (`darwin arm64`, 32 cores), Node `v24.21.0`. Every file here comes from one
sitting on one checkout at the head (`~/work/<task>`):
AFTER runs are the clean head; the concurrent-read BEFORE is the same checkout with
`extensions/memory-wiki` restored to the first draft `a5af25c3924` (`git restore --source=a5af25c3924
--staged --worktree -- extensions/memory-wiki`, every page read through one worker); the search
BEFORE is the same checkout with `extensions/memory-wiki` restored to the base `8e667761db3` (scan on
the main thread). Nothing else differs, and each capture's tree state is recorded beside it.
The harness forces the whole-vault path by searching an uncompiled vault (no digest), and
passes a never-aborted `AbortSignal` so the base run takes `main`'s signal-gated yield
path exactly as the `wiki_search` tool does; the tool's 30 s deadline is not applied.

Redactions applied to every file here, keeping each record otherwise whole: the home
directory is written as `~`, the machine's hostname (which appeared in the `uname -a`
line of the run logs) as `<host>`, and temporary paths under the system temporary
directory as `<tmp>`. No session ids or credentials appear in these files.

## Files

| File | What it is | How it was captured |
|---|---|---|
| `harness.mts` | The evidence harness. `generate` writes a deterministic vault (seeded PRNG, four page groups, claims-heavy frontmatter). `search` initializes the vault, warms the module graph (and the pool) with a non-matching query, then runs `searchMemoryWiki` through the real entrypoint while sampling `perf_hooks.monitorEventLoopDelay` (10 ms resolution), a 100 ms timer-chain probe (timer lateness plus `fs.access` latency), `process.threadCpuUsage()` of the calling thread, `process.memoryUsage()` and `Worker.getHeapStatistics()` for every worker announced on `process.on("worker")` (a ref'd timer keeps the process alive during the window because the pool unrefs idle workers); it stores every result object whole. `concurrent` starts one whole-vault search, then issues 20 exact-path `getMemoryWikiPage` reads one every 500 ms without waiting for the previous one, and times each read. `cold` is the first-read probe from the first draft's sitting, kept for reference and not re-run | `node --max-old-space-size=8192 --import tsx harness.mts <command> ...` from the checkout root |
| `vault-generate.json` | Generated vault shape and byte size: 10,000 pages, 60 body lines and 30 claims per page | harness `generate` |
| `bound/search-278mb-timeout.stdout`, `bound/concurrent-278mb-timeout.stdout`, `bound/vault-generate-278mb.json`, `bound/load-278mb-attempt.txt` | The sitting's first attempt on the first draft's vault shape (10,000 pages, 120 lines and 60 claims, 278.7 MB): its scan exceeds the 30 s task bound on this loaded machine and both harness commands rejected with `wiki_search timed out after 30s`; kept whole as the record of the bound firing, with the `uptime` samples of that attempt | harness `search` and `concurrent` at the head |
| `after/search.json`, `after/search.stdout` | AFTER run of the 10,000-page search at the head (scan in the worker pool) | harness `search --label after` |
| `before/search.json`, `before/search.stdout` | BEFORE run of the 10,000-page search with the plugin at the base (scan on the calling thread) | harness `search --label before` |
| `results-compare.json` | Comparison of the two search runs' complete `results` arrays: `JSON.stringify` equality over every result object with every field, in order, plus a per-index list of differences (empty when identical) and the field names present | `evidence.sh` `compare` |
| `after/concurrent.json`, `after/concurrent.stdout` | AFTER run of the concurrent-read harness at the head: 20 exact-path reads during a 10,000-page scan, per-read timings and p50/p99/max | harness `concurrent --label after` |
| `before-pr/concurrent.json`, `before-pr/concurrent.stdout` | The same with the plugin restored to the first draft `a5af25c3924` (reads queued behind the scan on one worker) | harness `concurrent --label before-pr` |
| `after/git-head.txt`, `before/git-*.txt`, `before-pr/git-*.txt` | Tree state recorded immediately before each run (`git rev-parse HEAD`, `git status --short`) | `evidence.sh` |
| `evidence-run.log` | Full stdout/stderr of the evidence script: vault generation, the three captures, every restore and status check, the red and green runs, the head test cost | `evidence.sh` |
| `red-scheduling.log`, `green-scheduling.log` | `query-scheduling.test.ts` from the head run against the first draft's production code (red) and at the head (green) | `pnpm vitest run extensions/memory-wiki/src/query-scheduling.test.ts` |
| `red-reader.log`, `green-reader.log` | `query-reader.test.ts` from the head run against the first draft's production code (red: the exact read is dispatched there) and at the head (green) | `pnpm vitest run extensions/memory-wiki/src/query-reader.test.ts` |
| `red.log`, `green.log` | `query.reads.test.ts` from the head run against the base production code (red) and at the head (green) | `post.sh` |
| `red-abort.log`, `green-abort.log` | `query.abort.test.ts` from the head run against the base (red: the file cannot load there) and at the head (green) | `post.sh` |
| `tests.log` | Owning lane `pnpm vitest run extensions/memory-wiki/` at the head | `gates.sh` |
| `check-changed.log` | `pnpm check:changed --base origin/main` at the head | `gates.sh` |
| `changed-lanes.json` | `pnpm changed:lanes --json --base origin/main` at the head, whole | `gates.sh` |
| `gates.log` | Full gates script output including `git diff --check` and `uptime` at its start and end | `gates.sh` |
| `test-cost.md` | Wall time per touched test file at the head (`pnpm test <file> --maxWorkers=1`), each timed run preceded by an untimed warm-up run of the same command | derived from `evidence-run.log` |
| `build-standalone.log` | Standalone plugin build (`node scripts/lib/plugin-npm-runtime-build.mjs extensions/memory-wiki`), whole, including the `entry:` line that consumes `openclaw.build.workerEntries` | `build.sh` |
| `build.log`, `build-run.log` | Root bundled build (`pnpm build`) at the head and the script log with the `dist/extensions/memory-wiki` worker listing and the worker's import lines | `build.sh` |
| `load-during-capture.txt` | `uptime` sampled at the start of every phase of `evidence.sh`, `post.sh` and `build.sh` (one line per phase: UTC time, phase, sample). The first block of lines belongs to the aborted attempt on the 278 MB vault (also kept under `bound/`), the second header starts the shipped run. A local model server (`llama-server`) and a Docker VM were running on the machine throughout, so every wall time is a loaded-machine figure | the scripts' `log` function |
| `evidence.sh`, `post.sh`, `build.sh`, `gates.sh` | The scripts that produced the logs above | copied from `~/work` |

## Timestamps

See the `date -u` lines in `evidence-run.log`, `post-run.log`, `build-run.log` and `gates.log`; the
`capturedAt` field in each JSON report is the harness's own UTC timestamp.
