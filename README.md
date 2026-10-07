# Evidence for openclaw/openclaw#166304

Branch `feat/memory-wiki-worker-vault-scan`, base `8e667761db3e749252a770d0c31006c436ec4b26`
(`origin/main` after #166329 and #166355 merged), head `a5af25c3924b21935856b4ff9f4e0be08d071a89`. The behaviour, build, profiler, CLI, red/green
and test-cost captures were taken at `ed494bdcddfb55014c88a9200791d769d8e62a8f`, whose production
tree, `dist/` and red/green test files are identical to the final head (the final head differs only
in `src/query-reader.test.ts`, two test edits, and the first commit's message); `tests.log`,
`check-changed.log`, `changed-lanes.json` and `gates.log` were re-run at the final head, and the
earlier `gates.log` (with its cold-cache timing pass) is kept as `gates-ed494bd.log`.
Machine: Mac Studio (`darwin arm64`), Node `v24.21.0`, pnpm 12.6.0. All captures in this
directory come from one sitting on one checkout (`~/work/<task>`): the BEFORE runs were
taken on the same checkout after `git restore --source=8e667761db3 --staged --worktree --
extensions/memory-wiki` (production and tests of the plugin at the base, nothing else
changed), the AFTER runs at the branch head with a clean `git status`, and the two vault
sizes ran back to back (see the `date -u` lines in `evidence-run.log`).
The harness forces the whole-vault path by searching an uncompiled vault (no digest), and
passes a never-aborted `AbortSignal` so the BEFORE run takes `main`'s signal-gated yield
path exactly as the `wiki_search` tool does; the tool's 30 s deadline is not applied.

Redactions applied to every file here, keeping each record otherwise whole: the home
directory is written as `~`, the machine's hostname (which appeared in the `uname -a`
line of the run logs) as `<host>`, and the profiler's temporary report paths under the
system temporary directory as `<tmp>`. No session ids or credentials appear in these files.

## Files

| File | What it is | How it was captured |
|---|---|---|
| `harness.mts` | The evidence harness. `generate` writes a deterministic vault (seeded PRNG, four page groups, claims-heavy frontmatter). `search` initializes the vault, warms the module graph (and the worker) with a non-matching query, then runs `searchMemoryWiki` through the real entrypoint while sampling `perf_hooks.monitorEventLoopDelay` (10 ms resolution), a 100 ms timer-chain probe (timer lateness plus `fs.access` latency), `process.threadCpuUsage()` of the calling thread, `process.memoryUsage()` (main-isolate heap and process RSS) and `Worker.getHeapStatistics()` for every worker thread announced on `process.on("worker")` (listener registered before the warm-up, where the pool creates the worker; a ref'd timer keeps the process alive during the window because the pool unrefs its idle worker). It stores every result object whole. | `node --max-old-space-size=8192 --import tsx harness.mts search ...` from the checkout root |
| `vault-generate.json` | Generated vault shape and byte size for the primary round: 10,000 pages | harness `generate` |
| `before/search.json`, `before/search.stdout` | BEFORE run on the 10,000-page vault (plugin at `origin/main`, scan on the calling thread) | harness `search --label before` |
| `after/search.json`, `after/search.stdout` | AFTER run on the 10,000-page vault (branch head, worker-backed reader) | harness `search --label after` |
| `results-compare.json` | Comparison of the two runs' complete `results` arrays: `JSON.stringify` equality over every result object with every field, in order, plus a per-index list of differences (empty when identical) and the field names present | `evidence.sh` `compare` |
| `vault-generate-2500pages.json`, `before-2500pages/`, `after-2500pages/`, `results-compare-2500pages.json` | The same harness on a 2,500-page vault, captured in the same sitting right after the 10,000-page round (both rounds wrote their vault to the same directory, `~/work/oss-166304-vault-`, one after the other) | same scripts, `--pages 2500` |
| `before*/git-status.txt`, `after*/git-status.txt`, `*/git-head.txt` | Tree state recorded immediately before each run | `git status --short`, `git rev-parse HEAD` |
| `evidence-run.log` | Full stdout/stderr of the evidence script: both rounds, every restore and status check, the base and head test cost runs, the red and green runs, the cold first read | `evidence.sh` |
| `red.log`, `green.log` | `query.reads.test.ts` from the branch head run against the base production code (red) and at the head (green) | `pnpm vitest run extensions/memory-wiki/src/query.reads.test.ts` |
| `red-abort.log`, `green-abort.log` | `query.abort.test.ts` from the branch head run against the base (red: the file cannot load there) and at the head (green) | `pnpm vitest run extensions/memory-wiki/src/query.abort.test.ts` |
| `tests.log` | Owning lane `pnpm vitest run extensions/memory-wiki/` at the final head | `gates.sh` |
| `check-changed.log` | `pnpm check:changed --base origin/main` at the final head | `gates.sh` |
| `changed-lanes.json` | `pnpm changed:lanes --json --base origin/main` at the head | `gates.sh` |
| `gates.log`, `gates-ed494bd.log` | Full gates script output including `git diff --check`, at the final head; `gates-ed494bd.log` is the same script at `ed494bd` and also holds a cold-cache per-file timing pass | `gates.sh` |
| `test-cost.md` | Wall time per touched test file (`pnpm test <file> --maxWorkers=1`), each timed run preceded by an untimed warm-up run of the same command, base and head in one sitting | derived from `evidence-run.log` (`gates-ed494bd.log` holds a cold-cache timing pass of the same files) |
| `build-standalone.log` | Standalone plugin build (`node scripts/lib/plugin-npm-runtime-build.mjs extensions/memory-wiki`), whole, including the `entry:` lines that consume `openclaw.build.workerEntries` | `build.sh` |
| `build.log`, `before/build.log`, `build-run.log` | Root bundled build (`pnpm build`) at the head and at the base, and the script log with the `dist/extensions/memory-wiki` worker listing | `build.sh` |
| `before/profile.log`, `after/profile.log` | Plugin entrypoint profiler (`OPENCLAW_LOCAL_CHECK=0 node --import tsx scripts/profile-extension-memory.mts --extension memory-wiki --skip-combined --concurrency 1`) on the base build and the head build, one run each, JSON reports whole | `build.sh` |
| `cli-run.log`, `cli-search1.out`, `cli-search2.out`, `cli-get1.out` | Built CLI (`node openclaw.mjs wiki status --json`, `wiki search`, `wiki get`) run by `build.sh` after it rebuilt `dist/` at the head, against the vault the evidence run left behind (2,500 generated pages plus the four scaffold files); `cli-run.log` is the script log section with the resolved vault path, exit codes and wall times, the `.out` files the command output | `build.sh` |
| `headbuild.log` | Second `pnpm build` at the head after the base build, so the CLI runs against the branch's `dist/`; the step's own lines (exit code, phase timings, worker file listing) are in `build-run.log` | `build.sh` |
| `load-during-capture.txt` | `uptime` and the top CPU consumers (`ps -Ao pcpu,etime,comm -r`) sampled once on the Studio during the 10,000-page BEFORE capture (load average 16.28): the machine's local model server (`llama-server`, about 490% CPU) and a Docker VM ran throughout this sitting but were not sampled per phase, so every wall time in this round is a loaded-machine figure; BEFORE and AFTER ran back to back under that load | manual snapshot during `evidence.sh` |
| `cold-first-read.json` | First, second and third `getMemoryWikiPage` exact-path read after process start at the head on the 2,500-page vault (the first read spawns the worker) | harness `cold` |
| `evidence.sh`, `build.sh`, `gates.sh` | The scripts that produced the logs above | copied from `~/work` |

## Timestamps

See the `date -u` lines in `evidence-run.log`, `build-run.log` and `gates.log`; the
`capturedAt` field in each `search.json` is the harness's own UTC timestamp.
