# Evidence for openclaw/openclaw#166304 (PR #166433)

Branch `feat/memory-wiki-worker-vault-scan`. Captured at `af0d2a13c409aa86fa8b9635550df2d7330884c0`
on base `ebc4e6de603c5c1ce55086f13565e21feb1c297d`; the pushed head
`94dd0a0e7f0b7f7dda61da0a9494c0ac55914f23` differs from it only in comments, docs, the README and
one constant now imported instead of written out (`af0d2a1-to-head.diff`), and its owning lane and
`check:changed` are `head-94dd-lane.log` and `head-94dd-check-changed.log`. Machine: Mac Studio
(`darwin arm64`, Apple M3 Ultra, 32 cores), Node `v24.21.0`. Every other file here comes from one
sitting on one checkout (`~/work/oss-166304`) on 2026-10-07, 21:49:30Z to 22:55:41Z, run by
`chain.sh` and `chain-post.sh` in this order: `evidence.sh` (whole output in `evidence-run.log`),
`evidence2.sh` (`evidence2-run.log`), `sweep.sh` (`sweep/sweep-run.log`), `mutants.sh`
(`mutants/mutants-run.log`), `post.sh` (`post-run.log`). `load-during-capture.txt` holds an `uptime`
sample at the start of every phase.

Trees compared, each produced in the same checkout by restoring only `extensions/memory-wiki`
(`git restore --source=<tree> --staged --worktree -- extensions/memory-wiki`), with the tree recorded
beside the capture (`plugin-source.txt`, `git-status.txt`):

| Label in file names | Tree | What it is |
|---|---|---|
| `head` / `after` | `af0d2a13c40` | this PR: a scan is one pool task that checkpoints with the host every 64 pages and yields when another task waits for its permit or worker |
| `base` / `before` | `ebc4e6de603` | `main`: scans on the calling thread |
| `prev` / `before-r4` | `19353569c95` | the previously published head: the same two-worker pool with each scan as one task that never yields |
| `fixed-batches` (in `cpu/`) | `832afc5b07d` | a listing task plus one pool task per 64 pages, submitted one at a time (`cpu/fixed-batches-variant.diff`) |
| `pool-timeout` | `492827c8100` | the never-yielding pool with a 30 s `timeoutMs` on every scan task |
| `first-draft` / `before-pr` | `a5af25c3924` | single-worker variant: every read, single-page reads included, through one worker |

`sweep/` changes only the value of `WIKI_SCAN_CHECKPOINT_PAGES` in the head's working tree (patched
with `sed`, restored after each size; `sweep.sh`). `mutants/` changes one construct per mutant
(each `.diff` is the exact change).

Redactions, keeping each record otherwise whole: the home directory is written `~`, vitest temporary
vault directories `<tmp>`. The machine's hostname does not appear. No session ids or credentials
appear here. The `update_metadata` result files (`compat/*/cli-apply.json`,
`compat/log-diff/*-cli-apply.json`) embed the compile report of the whole vault (about 21.7 MB
each); `apply.compile` is reduced to its key list and page count, and the field says so, and the
matching `cli-apply.stdout` files (the same JSON printed) are omitted. GC traces are gzipped
(`cpu/*.gc.log.gz`). Every other field is whole.

Background load: a local model server and a Docker VM ran throughout (one-minute load 1.96 to 9.85
at the phase starts). Wall times are loaded-machine figures; only paired comparisons and outcomes
are read.

## Files

| File | What it is |
|---|---|
| `harness.mts` | Evidence harness. `search` runs `searchMemoryWiki` through the real entrypoint while sampling event-loop delay, a 100 ms timer and `fs.access` probe, calling-thread CPU and heaps; `concurrent` issues 20 exact-path `getMemoryWikiPage` reads during a whole-vault search; `budget` runs one caller shape (`cli-search`, `cli-get`, `cli-apply`: `searchMemoryWiki`, `getMemoryWikiPage`, `applyMemoryWikiMutation` with no signal, the `openclaw wiki search/get/apply metadata` call shapes; `tool`: the real `wiki_search` tool with its 30 s deadline); `contention` is described below |
| `single-permit.cjs` | `--require` preload for `contention`: sets `os.availableParallelism()` to 2 and syncs the ESM view, so `getWorkerComputeCapacity()` (`max(1, cores - 1)`) creates one shared permit, as on a one- or two-core host. Every `contention` file records `computeCapacity.limit: 1` from the capacity's own snapshot |
| `contention/<tree>/{10k,20k}-rep<n>.json` | `contention`: warms memory-core's retrieval pool and the wiki pool, times one idle retrieval task (`idleRetrievalMs`), starts an unsignalled whole-vault `searchMemoryWiki` (the `wiki.search` RPC and `memory_search` supplement call shape), and every second submits `runMemoryPresenceInspection` from `extensions/memory-core/src/memory/manager-cpu-worker-runtime.ts`, a task in the retrieval pool memory-core keyword search uses (`maxWorkers: 1`, `sharedCompute: true`), timing each from submission to result (`perProbe`). `results` holds the scan's ten result objects; `results-compare-*.json` compare them across trees. `base` ran once per vault (phase 2), `prev` and `head` twice |
| `sweep/` | `contention-20k-c<N>-r<n>.json` and `search-10k-c<N>-r<n>.json` for N = 16, 64, 256, 1024 pages per checkpoint, two runs each; summary lines in `sweep-run.log` |
| `cpu/` | Default-capacity 10,000-page `search` with `--trace-gc`, head and the fixed-batches variant alternating, three runs each (`post.sh`); the summary line per run (process CPU, wall, worker heap peak, scavenges and mark-compacts of the busiest isolate) is in `post-run.log` |
| `tests.log`, `check-changed.log`, `changed-lanes.json` | Owning lane `pnpm vitest run extensions/memory-wiki/`, `pnpm check:changed --base upstream/main` (exit 0 in `evidence-run.log`) and `pnpm changed:lanes --json --base upstream/main`, at the captured tree |
| `red/red-*.log`, `red/green-*.log` | The head's changed test files against the previously published head's production code (`red-<file>.log`, `evidence.sh`) and at the head (`green-<file>.log`); `red-first-draft-query-scheduling.log` and `red-pool-timeout-query-scheduling.log` run the head's `query-scheduling.test.ts` against those two variants (`post.sh`) |
| `mutants/` | Five mutants against `query-scheduling.test.ts`, `query-shared-compute.test.ts` and `query-reader.test.ts`: segment merge order reversed in the worker, task merge order reversed on the host, host never answers yield, worker ignores a yield answer, lookup match not re-checked after the in-thread re-read; the diff and the vitest output of each |
| `before/`, `after/`, `before-r4/`, `results-compare.json` | 10,000-page vault (60 lines, 30 claims, 140.5 MB): `search.json` for base, head and the previously published head; `results-compare.json` compares base and head result objects; `after/results-compare-base.json` compares the head with the base capture of an earlier sitting |
| `before-r4-20k/`, `after-20k/` | The same `search` on the 20,000-page vault of the deadline-ownership table, previously published head and head |
| `before-pr/concurrent.json`, `after/concurrent.json` | Concurrent exact reads during a scan, single-worker variant and head |
| `budget/<tree>/` | Deadline ownership on a 20,000-page vault (120 body lines, 60 claims per page, 558.7 MB): `cli-search`, `cli-get`, `tool` for base, the pool-timeout variant and head; `budget/results-compare.json` compares the `cli-search` result objects of base and head |
| `compat/` | On-disk compatibility on a 2,000-page vault compiled by the base code (`vault-compat-now.sha256` is its tree at this sitting). Reads: one fresh copy searched and read by basename by base, another by head; `tree-after-{base,head}-queries.sha256` hash every file afterwards (both identical to `vault-compat-now.sha256`, stated in `evidence2-run.log`); `results-compare.json` compares the search results. Writes: one fresh copy given `update_metadata` by base, another by head; `tree-after-{base,head}-apply.ts-normalized.sha256` with ISO-8601 timestamps replaced, whose only difference is `.openclaw-wiki/log.jsonl` (`evidence2-run.log`, `apply-ts-normalized.diff`); `log-diff/log-jsonl.ts-normalized.diff` (`post.sh`, another pair of fresh copies) shows that the two compile log lines differ only in their random reservation and publication ids and in `compiledCacheSourceGeneration`, a digest over page bytes that differs because the pages' `updatedAt` differs. `persisted-modules-diffstat.txt` is the (empty) base-to-head diff over the modules that define stored formats. Phase 1 (`evidence-run.log`, "COMPAT at the head") also compared against a hash list from an earlier capture of this vault, which had been recompiled since; those diff lines are not used, the same-sitting comparison above is |
| `build-standalone.log`, `build.log` | `node scripts/lib/plugin-npm-runtime-build.mjs extensions/memory-wiki` (`evidence.sh`) and `pnpm build` (`evidence2.sh`) at the captured tree; the worker file listing and its imports are in `evidence2-run.log` |
| `af0d2a1-to-head.diff`, `head-94dd-lane.log`, `head-94dd-check-changed.log` | The captured tree to the pushed head, and the owning lane and `check:changed` at the pushed head (both exit 0) |
