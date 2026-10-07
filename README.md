# Evidence for openclaw/openclaw#166304 (PR #166433)

Branch `feat/memory-wiki-worker-vault-scan`, head `832afc5b07d17847c16c8316b66a82db0b2b283b`, base
`ebc4e6de603c5c1ce55086f13565e21feb1c297d`. Machine: Mac Studio (`darwin arm64`, Apple M3 Ultra,
32 cores), Node `v24.21.0`. Every file here comes from one sitting on one checkout
(`~/work/oss-166304`) on 2026-10-07, 20:09:08Z to 21:00:44Z, run by `chain.sh` and `chain-post.sh`
in this order: `evidence.sh` (whole output in `evidence-run.log`), `evidence2.sh`
(`evidence2-run.log`), `sweep.sh` (`sweep/sweep-run.log`), `mutants.sh` (`mutants/mutants-run.log`),
`post.sh` (`post-run.log`). `load-during-capture.txt` holds an `uptime` sample at the start of every
phase.

Trees compared, each produced in the same checkout by restoring only `extensions/memory-wiki`
(`git restore --source=<tree> --staged --worktree -- extensions/memory-wiki`), with the tree recorded
beside the capture (`plugin-source.txt`, `git-status.txt`):

| Label in file names | Tree | What it is |
|---|---|---|
| `head` / `after` | `832afc5b07d` | this PR: scans as a listing task plus 64-page batch tasks |
| `base` / `before` | `ebc4e6de603` | `main`: scans on the calling thread |
| `prev` / `before-r4` | `19353569c95` | unbatched variant: the same two-worker pool with each scan as one task |
| `pool-timeout` | `492827c8100` | the unbatched pool with a 30 s `timeoutMs` on every scan task |
| `first-draft` / `before-pr` | `a5af25c3924` | single-worker variant: every read, single-page reads included, through one worker |

`sweep/` changes only the value of `WIKI_SCAN_BATCH_PAGES` in the head's working tree (patched with
`sed`, restored after each size; `sweep.sh`). `mutants/` changes one construct of
`query-reader.ts` per mutant (each `.diff` is the exact change).

Redactions, keeping each record otherwise whole: the home directory is written `~`, temporary
directories `<tmp>`. The machine's hostname does not appear. No session ids or credentials appear
here. The `update_metadata` result files (`compat/*/cli-apply.json`, `compat/log-diff/*-cli-apply.json`)
embed the compile report of the whole vault (about 21.7 MB each); `apply.compile` is reduced to its
key list and page count, and the field says so. Every other field is whole.

Background load: a local model server and a Docker VM ran throughout (one-minute load 1.9 to 16 at
the phase starts). Wall times are loaded-machine figures; only paired comparisons and outcomes are
read.

## Files

| File | What it is |
|---|---|
| `harness.mts` | Evidence harness. `search` runs `searchMemoryWiki` through the real entrypoint while sampling event-loop delay, a 100 ms timer and `fs.access` probe, calling-thread CPU and heaps; `concurrent` issues 20 exact-path `getMemoryWikiPage` reads during a whole-vault search; `budget` runs one caller shape (`cli-search`, `cli-get`, `cli-apply`: `searchMemoryWiki`, `getMemoryWikiPage`, `applyMemoryWikiMutation` with no signal, the `openclaw wiki search/get/apply metadata` call shapes; `tool`: the real `wiki_search` tool with its 30 s deadline); `contention` is described below |
| `single-permit.cjs` | `--require` preload for `contention`: sets `os.availableParallelism()` to 2 and syncs the ESM view, so `getWorkerComputeCapacity()` (`max(1, cores - 1)`) creates one shared permit, as on a one- or two-core host. Every `contention` file records `computeCapacity.limit: 1` from the capacity's own snapshot |
| `contention/<tree>/{10k,20k}-rep<n>.json` | `contention`: warms memory-core's retrieval pool and the wiki pool, times one idle retrieval task (`idleRetrievalMs`), starts an unsignalled whole-vault `searchMemoryWiki` (the `wiki.search` RPC and `memory_search` supplement call shape), and every second submits `runMemoryPresenceInspection` from `extensions/memory-core/src/memory/manager-cpu-worker-runtime.ts`, a task in the retrieval pool memory-core keyword search uses (`maxWorkers: 1`, `sharedCompute: true`), timing each from submission to result (`perProbe`). `results` holds the scan's ten result objects; `results-compare-*.json` compare them across trees |
| `sweep/` | `contention-20k-b<N>.json` and `search-10k-b<N>.json` for N = 16, 64, 128, 256, 512 pages per batch; summary lines in `sweep-run.log` |
| `tests.log`, `check-changed.log`, `changed-lanes.json` | Owning lane `pnpm vitest run extensions/memory-wiki/`, `pnpm check:changed --base upstream/main` (exit 0 in `evidence-run.log`) and `pnpm changed:lanes --json --base upstream/main`, at the head |
| `red/red-*.log`, `red/green-*.log` | The head's changed test files against the unbatched variant (`red-<file>.log`, `evidence.sh`) and at the head (`green-<file>.log`); `red-first-draft-query-scheduling.log` and `red-pool-timeout-query-scheduling.log` run the head's `query-scheduling.test.ts` against those two variants (`post.sh`) |
| `mutants/` | Three mutants of `query-reader.ts` (merge order reversed, one unbatched task, batches submitted in parallel) against `query-scheduling.test.ts` and `query-shared-compute.test.ts`: the diff and the vitest output of each |
| `before/`, `after/`, `before-r4/`, `results-compare.json` | 10,000-page vault (60 lines, 30 claims, 140.5 MB): `search.json` for base, head and the unbatched variant; `results-compare.json` compares base and head result objects |
| `before-pr/concurrent.json`, `after/concurrent.json` | Concurrent exact reads during a scan, single-worker variant and head |
| `budget/<tree>/` | Deadline ownership on a 20,000-page vault (120 body lines, 60 claims per page, 558.7 MB): `cli-search`, `cli-get`, `tool` for base, the pool-timeout variant and head; `budget/results-compare.json` compares the `cli-search` result objects of base and head |
| `compat/` | On-disk compatibility on a 2,000-page vault compiled by the base code (`vault-compat-now.sha256` is its tree at this sitting). Reads: one fresh copy searched and read by basename by base, another by head; `tree-after-{base,head}-queries.sha256` hash every file afterwards (both identical to `vault-compat-now.sha256`, stated in `evidence2-run.log`); `results-compare.json` compares the search results. Writes: one fresh copy given `update_metadata` by base, another by head; `tree-after-{base,head}-apply.ts-normalized.sha256` with ISO-8601 timestamps replaced, whose only difference is `.openclaw-wiki/log.jsonl` (`evidence2-run.log`); `log-diff/log-jsonl.ts-normalized.diff` (`post.sh`, another pair of fresh copies) shows that the two compile log lines differ only in their random reservation and publication ids and in `compiledCacheSourceGeneration`, a digest over page bytes that differs because the pages' `updatedAt` differs. `persisted-modules-diffstat.txt` is the (empty) base-to-head diff over the modules that define stored formats. Phase 1 (`evidence-run.log`, "COMPAT at the head") also compared against a hash list from an earlier capture of this vault, which had been recompiled since; those diff lines are not used, the same-sitting comparison above is |
| `build-standalone.log`, `build.log` | `node scripts/lib/plugin-npm-runtime-build.mjs extensions/memory-wiki` (`evidence.sh`) and `pnpm build` (`evidence2.sh`) at the head; the worker file listing and its imports are in `evidence2-run.log` |
