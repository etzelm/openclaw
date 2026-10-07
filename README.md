# Evidence for openclaw/openclaw#166304

Branch `feat/memory-wiki-worker-vault-scan`, base `8e667761db3e749252a770d0c31006c436ec4b26`
(`origin/main` after #166329 and #166355 merged), head `f6038b3097c077ef2d6b80ac729df53dacb7d8e1`.
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
line of the run logs) as `<host>`, and the profiler's temporary report paths under
`<tmp> as `<tmp>`. No session ids or credentials appear in these files.

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
| `evidence-run.log` | Full stdout/stderr of the evidence script: both rounds, every restore and status check, the base-side test cost runs, the red and green runs | `evidence.sh` |
| `red.log`, `green.log` | `query.reads.test.ts` from the branch head run against the base production code (red) and at the head (green) | `pnpm vitest run extensions/memory-wiki/src/query.reads.test.ts` |
| `red-abort.log`, `green-abort.log` | `query.abort.test.ts` from the branch head run against the base (red: the file cannot load there) and at the head (green) | `pnpm vitest run extensions/memory-wiki/src/query.abort.test.ts` |
| `tests.log` | Owning lane `pnpm vitest run extensions/memory-wiki/` at the head | `gates.sh` |
| `check-changed.log` | `pnpm check:changed --base origin/main` at the head | `gates.sh` |
| `changed-lanes.json` | `pnpm changed:lanes --json --base origin/main` at the head | `gates.sh` |
| `gates.log` | Full gates script output including `git diff --check` and the head-side per-file test cost | `gates.sh` |
| `test-cost.md` | Wall time per touched test file (`pnpm test <file> --maxWorkers=1`), base and head where the file exists on both | derived from `gates.log` and `evidence-run.log` |
| `build-standalone.log` | Standalone plugin build (`node scripts/lib/plugin-npm-runtime-build.mjs extensions/memory-wiki`), whole, including the `entry:` lines that consume `openclaw.build.workerEntries` | `build.sh` |
| `build.log`, `before/build.log`, `build-run.log` | Root bundled build (`pnpm build`) at the head and at the base, and the script log with the `dist/extensions/memory-wiki` worker listing | `build.sh` |
| `before/profile.log`, `after/profile.log` | Plugin entrypoint profiler (`OPENCLAW_LOCAL_CHECK=0 node --import tsx scripts/profile-extension-memory.mts --extension memory-wiki --skip-combined --concurrency 1`) on the base build and the head build, one run each, JSON reports whole | `build.sh` |
| `cli-run.log`, `cli-search1.out`, `cli-search2.out`, `cli-get1.out` | Built CLI (`node openclaw.mjs wiki status --json`, `wiki search`, `wiki get` from the head `dist/`, rebuilt after `build.sh` had left the base build in `dist/`) against the 2,504-page vault; `cli-run.log` has the resolved vault path, exit codes and wall times, the `.out` files the command output. `build-run.log` also contains three earlier CLI runs from `build.sh` that hit an empty vault (its config pointed at a directory the second evidence round had not used), kept as recorded | foreground run after `build.sh` |
| `cli-exit.log` | Earlier attempt to run the CLI from source (`pnpm dev`): all three runs exited 1 with `reason: 'launchd-gui-domain-unavailable'` before reaching the search; kept whole as the record of that failure | `cli-exit.sh` |
| `evidence.sh`, `build.sh`, `gates.sh`, `cli-exit.sh` | The scripts that produced the logs above | copied from `~/work` |

## Timestamps

See the `date -u` lines in `evidence-run.log`, `build-run.log` and `gates.log`; the
`capturedAt` field in each `search.json` is the harness's own UTC timestamp.
