# Evidence for openclaw/openclaw#166304 (PR #166433)

Branch `feat/memory-wiki-worker-vault-scan`, head `083b81fb217ddb73007837aabc5bb9a2aa702cad`, base
`ebc4e6de603c5c1ce55086f13565e21feb1c297d` (`origin/main` at capture time). Machine: Mac Studio
(`darwin arm64`, Apple M3 Ultra, 32 cores), Node `v24.21.0`. Every file here comes from one sitting
on one checkout (`~/work/oss-166304`) on 2026-10-07: `evidence.sh` (16:07:30Z to 17:06:29Z, whole
output in `evidence-run.log`), then `post/post.sh` (whole output in `post/post-run.log`), then one
hand-run `diff` recorded in `compat/apply-log-jsonl.ts-normalized.diff` (its header says so).

Trees compared, each produced in the same checkout by restoring only `extensions/memory-wiki`
(`git restore --source=<tree> --staged --worktree -- extensions/memory-wiki`), with the tree state
recorded beside each capture (`git-head.txt`, `git-status.txt`):

| Label in file names | Tree | What it is |
|---|---|---|
| `head` / `after` | `083b81fb217` | this PR |
| `base` / `before` | `ebc4e6de603` | `main`: scans on the calling thread |
| `previous-head` | `492827c8100` | pool-timeout variant: the same pool with a 30 s `timeoutMs` on every scan task |
| `first-draft` / `before-pr` | `a5af25c3924` | single-worker variant: every read, single-page reads included, through one worker |

Redactions, keeping each record otherwise whole: the home directory is written `~`, the machine's
hostname `<host>`, temporary directories `<tmp>`. No session ids or credentials appear here.

Background load: a local model server and a Docker VM ran throughout; the REPEAT phase adds 28
busy-loop processes on purpose, and the load they leave decays through the next phases (see
`load-during-capture.txt`). Wall times are loaded-machine figures; only paired comparisons and
outcomes are read.

## Files

| File | What it is |
|---|---|
| `harness.mts` | Evidence harness. `generate` writes a deterministic vault; `search` runs `searchMemoryWiki` through the real entrypoint while sampling event-loop delay, a timer/`fs.access` probe, calling-thread CPU and heaps; `concurrent` issues 20 exact-path `getMemoryWikiPage` reads during a whole-vault search; `budget` runs one caller shape: `cli-search`, `cli-get` and `cli-apply` call `searchMemoryWiki`, `getMemoryWikiPage` and `applyMemoryWikiMutation` (`update_metadata`) with no signal, the call shapes of `openclaw wiki search`, `wiki get` and `wiki apply metadata` (`cli.ts`); `tool` runs the real `wiki_search` tool with its 30 s deadline |
| `evidence.sh`, `evidence-run.log`, `load-during-capture.txt` | The script, its whole output, and an `uptime` sample at the start of every phase |
| `tests.log` | Owning lane `pnpm vitest run extensions/memory-wiki/` at the head |
| `check-changed.log`, `changed-lanes.json` | `pnpm check:changed --base upstream/main` (exit 0, see `evidence-run.log`) and `pnpm changed:lanes --json --base upstream/main` at the head |
| `red-first-draft-scheduling.log`, `red-previous-head-scheduling.log`, `green-scheduling.log` | The head's `query-scheduling.test.ts` against the single-worker variant's production code, against the pool-timeout variant's, and at the head |
| `repeat/summary.txt` | 30 consecutive runs of `query-scheduling.test.ts` at the head and 30 of the pool-timeout variant's own scheduling test file against its own production code, both under 28 extra busy-loop processes (`nice 5`); a failing run would have been kept as `repeat/<label>-fail-<n>.log` (none) |
| `budget/` | Deadline ownership on a 20,000-page vault (120 body lines, 60 claims per page, 558.7 MB, `vault-generate.json`): `budget/<tree>/{cli-search,cli-get,tool}.json` + `.stdout` per tree; `results-compare.json` compares every `cli-search` result object, base versus head |
| `budget/cli-built/` | The built `node openclaw.mjs wiki search` / `wiki get` on the 20,000-page vault (fresh state directory, no gateway): both aborted with a main-thread heap OOM (`search.stderr`, `get.stderr`); `main-isolate-profile.txt` is a V8 tick profile of a 90 s rerun, whose hot frames are `extractWikiLinks` ← `scanWikiPageSummary` ← the anonymous frame `presentation-DX_yu183.mjs:1544`, and `evidence-run.log` records that `readPageSummaries` (the compile reader, `compile.ts:335`) is declared at line 1540 of that chunk; `small-vault-search.json` is the built search on the 2,000-page vault (results returned, timing in `evidence-run.log`) |
| `vault-generate.json`, `after/`, `before/`, `before-pr/`, `results-compare.json` | The 10,000-page vault (60 lines, 30 claims, 140.5 MB): search AFTER (head) / BEFORE (base) pair with every result compared; concurrent-read AFTER (head) / BEFORE-PR (single-worker variant) pair |
| `compat/` | On-disk compatibility on a 2,000-page vault compiled by the base code and copied four times. Reads: one copy searched and read by basename by base, one by head; `tree-after-{base-compile,base-queries,head-queries}.sha256` hash every file (2,019 files, identical); `results-compare.json` compares the search results. Writes: one copy given an `update_metadata` (`status: reviewed`, one question) by base, one by head; `tree-after-{base,head}-apply.sha256` raw and `.ts-normalized.sha256` with ISO-8601 timestamps replaced; `compat/<tree>/cli-apply.json` holds each `update_metadata` result with its embedded compile report (about 21.7 MB) reduced to its key list, every other field whole; `apply-raw-differing-files.txt` lists the 5 files whose raw bytes differ; after timestamp normalization only `.openclaw-wiki/log.jsonl` differs, and `apply-log-jsonl.ts-normalized.diff` shows that its differences are random compile reservation/publication UUIDs and the source-generation digest, a SHA-256 over page bytes (`log.ts:95`) that differs because the pages' `updatedAt` differs. `persisted-modules-diffstat.txt` is the (empty) base-to-head diff over the modules that define stored formats; `package-json.diff` is the one manifest change (`openclaw.build.workerEntries`) |
| `build-standalone.log`, `build.log` | `node scripts/lib/plugin-npm-runtime-build.mjs extensions/memory-wiki` and `pnpm build` at the head; worker file listings and imports are in `evidence-run.log` |
| `post/` | Red/green for `query-reader.test.ts` (red against the single-worker variant), `query.reads.test.ts` and `query.abort.test.ts` (red against base), and warm per-file test cost (`pnpm test <file> --maxWorkers=1`, one untimed warm-up run first) for every touched test file, in `post-run.log` |
