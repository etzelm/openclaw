# merge5: origin/main into #164796 staged tip d20c06b61fb (compaction fix), re-proved

Studio, 2026-10-20. Fresh `--filter=blob:none` clone `~/work/pr-164796-m5`, `pull/164796/head:pr` (53ff5be1f3b) plus `fix.bundle` (`fix-pr` = d20c06b61fb). Both work dirs deleted at the end. Nothing pushed, signed, commented or requested.

- **Merged main: `051bf6fa4d05e0870d0f360aee7ac1643cbb787d`** (origin/main at start, 2026-10-20 17:26 UTC, #178578; newer than the briefed f20c3c758bb).
- **Merge commit: `af1d1ce4a2aee17f413256a4241a9c9f9b4c4e0d`**, **tree `76779f6d8d21527ba0778b448dc7c28d546f6f12`**, parents `d20c06b61fb2206cb6c97802732124cda6edd394` + `051bf6fa4d05e0870d0f360aee7ac1643cbb787d`. Author and committer `Mitchell Etzel <etzelm@users.noreply.github.com>`, unsigned. Message `Merge remote-tracking branch 'origin/main' into fix/cli-native-history-owner`.
- **Compaction fix kept.** Main has no equivalent fix. No main commit after e12719836f8 touches `session-prompt-state.ts`, `terminal-resolution.ts`, `attempt-prompt-submit.ts` or the e2e test. The e2e fails 3/3 on pristine main `051bf6fa4d0` (see "CI tests" below).

## Conflict resolutions (`diff-merge-resolution.patch` = `git show --remerge-diff af1d1ce4a2a`)

There are two conflicts, the same two that merge `0bab7cf44a7` (PR head + main dca495505aa) hit. Both come from main `6b5279a6512` (#178173, `onEntryUpdated`). I resolved them the same way. The resolved blobs `fb6cf63ae93` (boundary) and `aeccb6297d0` (worker) are byte-identical to `0bab7cf44a7`'s. The remerge diff also matches `0bab7cf44a7`'s, except for the conflict-marker labels and the pre-resolution `index` lines (`gates/cmp.sh`).

`src/config/sessions/session-accessor.sqlite-cli-history-boundary.ts`: both optional params are kept, the PR's first. The PR's owner check stays after `assertCurrent()`. Main's `updatedEntry` write plus `onEntryUpdated?.()` replaces the PR's bare write. A refused owner check writes nothing and fires no callback.

```diff
   assertCurrent: () => void,
-<<<<<<< HEAD
   confirmsOwner?: () => boolean,
-=======
   onEntryUpdated?: (entry: InternalSessionEntry) => void,
->>>>>>> 051bf6fa4d0
 ...
   assertCurrent();
-<<<<<<< HEAD
   if (!cliHistoryOwnerHolds(writer, confirmsOwner)) {
     return false;
   }
-  writeSessionEntry(database, scope.sessionKey, next, { previousEntry: entry });
-=======
   const updatedEntry = writeSessionEntry(database, scope.sessionKey, next, {
     previousEntry: entry,
   });
   onEntryUpdated?.(updatedEntry);
->>>>>>> 051bf6fa4d0
```

`src/config/sessions/session-accessor.sqlite-transcript-reports.worker.ts`: the call passes both arguments.

```diff
                   authorizeCommit,
-<<<<<<< HEAD
                   ownerProbe?.holds,
-=======
                   onEntryUpdated,
->>>>>>> 051bf6fa4d0
```

Generated config baseline:
- It auto-merged. `pnpm config:docs:check` was OK before regeneration, `pnpm config:docs:gen` (exit 0) changed nothing, and `config:docs:check` was OK again afterwards (`gates/config-docs-*.log`).
- Against merged main: counts `plugin` 4759 -> 4761; sha256 `config-baseline.json` 8d2d3997...149e -> 41db2d9b...6946 and `config-baseline.plugin.json` 00a9f293...7f2a -> 2ce573a6...a958. These are the same values as merge4.

`nativeLoginOwnerHash` auto-merged where merge4 placed it, in `createCliLiveSessionCapability`. RED13 matched exactly once and is proven below.

## Line deltas vs merged main (`numstat-after.txt`)

- **38 files +2657/-283.** That is identical, file by file, to d20c06b61fb against its own base 79506514289. The merge adds nothing to the PR surface.
- Split: production 23 files +865/-143, tests 12 files +1784/-134, docs 3 files +8/-6.
- Against merge4 (36 files +2641/-283), the +16 lines and 2 files are the compaction fix: `session-prompt-state.ts` +4 and `run.session-prompt-state.test.ts` +12.

## Gates at af1d1ce4a2a (`gates/summary.txt`, `gates/vitest-lines.txt`)

`OPENCLAW_VITEST_MAX_WORKERS=8`, and `pnpm test` was not fenced after `pnpm build`. Studio load was 4 to 45.

| Gate | Result |
|---|---|
| `pnpm build` | exit 0 |
| `node --import tsx scripts/tsdown-build.mts --config tsdown.ai.config.ts` | exit 0 |
| `pnpm tsgo:core` / `tsgo:core:test` / `tsgo:extensions` / `tsgo:extensions:test` | exit 0 / 0 / 0 / 0 |
| Targeted (11 files) | exit 0, `[test] passed 5 Vitest shards in 70.25s`: 3+1+1+5+1 = 11 files, 46+28+17+99+53 = **243 tests** (merge4: 227 plus 16 from `run.session-prompt-state.test.ts`) |
| Lane `src/agents/cli-runner/` | exit 0, `[test] passed 5 Vitest shards`: 13+3+7+41+1 = 65 files, 68+12+233+459+5 = 777 tests |
| Lane `extensions/anthropic/` | exit 0, 37 files, 417 passed + 1 skipped |
| `src/plugin-sdk/provider-auth-claude-compat.test.ts` | exit 0, 28 |
| Lane `src/agents/sessions/` | exit 0, 4 shards: 88+1 skipped / 64 / 371 / 677+4 skipped |
| Lane `src/config/sessions/` | **first run exit 1** (1 failure, a load flake, see below); **rerun exit 0**: 224, then `Test Files 370 passed / 3 skipped (373)`, `Tests 3365 passed / 13 skipped (3378)` |
| Lane `src/agents/embedded-agent-runner/` | exit 0, `[test] passed 7 Vitest shards in 440.44s`, files/tests per shard: 73/747, 12/81, 96/1410, 70/846, 1/16, 1/9, 116/1552, all passed |
| `git diff --check 051bf6fa4d0 HEAD` | exit 0 |
| `oxfmt --check` (changed files) | exit 0 |
| `pnpm check:changed --base 051bf6fa4d0` | **exit 1**: 42 ok, 2 failed, both identical on pristine main (see below) |
| `pnpm check:madge-import-cycles` | exit 0, `0 cycle(s)` |

### config/sessions first-run failure: load flake, main-identical

The failing case was `session-history-archive-pruning.admission.test.ts > enforces a physical archive budget without ordinary host SQLite calls`, with `Error: database is locked` (errcode 5) in the test's own `seedFreePages` fixture. The test file is identical to main, and the PR touches no archive-pruning code. Studio load was 31 to 40 during that lane. Logs are in `gates/followup/`.

| Run | Result |
|---|---|
| Alone at the merge, 3 runs | 3/3 pass, 17/17 each |
| Alone on pristine main `051bf6fa4d0`, 3 runs | 3/3 pass, 17/17 each |
| Full lane rerun at the merge (load 14 to 45) | exit 0, 3365 passed / 13 skipped |
| Full lane on pristine main (own worktree, install and build; load 45 to 49) | exit 0, the same totals: 224; 370 passed / 3 skipped; 3365 passed / 13 skipped |

Verdict: a load-dependent SQLite lock flake. It passes alone and on rerun at the merge, and the totals are identical to pristine main. Merge4's known archive-read timeout did not recur in either run.

### check:changed failures, identical on pristine main (`gates/pristine/checks.txt`)

| Check | Merge | Pristine main 051bf6fa4d0 |
|---|---|---|
| max-lines suppression ratchet | 3 new suppressions: `ui/src/pages/chat/components/chat-message.test.tsx`, `ui/src/pages/config/config-page-state.ts`, `ui/src/pages/sessions/sessions-page-state.ts` (same 3 as merge4) | same 3, exit 1 |
| core tsgo graph boundary | `agents-tools: 721`, `gateway-root: 724`, `infra: 723`, `plugins-platform: 727` test roots > 720 | same 4 numbers, exit 1 |

`ui/` and `test/tsconfig/` are identical to main. All other checks are ok, including the line-cap growth ratchet ("no new violations or over-cap growth"), the SQLite worker ratchet (171 -> 171), the config docs baseline, typecheck core/core tests/extensions/extension tests, lint core, lint extensions and the dead export scan. That last scan is clean now, while merge4's main had one entry.

## The three CI tests that failed at 53ff5be1f3b (3 runs each at the merge)

`OPENCLAW_VITEST_RUNTIME=node OPENCLAW_E2E_USE_PREBUILT_DIST=1` after `pnpm build` and the ai build. Each test ran through `node_modules/.bin/vitest run --config <config>`.

| Test (config) | Merge af1d1ce4a2a | Pristine main 051bf6fa4d0 |
|---|---|---|
| `test/gateway-openai-compaction-replay.e2e.test.ts` (`vitest.e2e.config.ts`) | **PASS 3/3** (1/1 each) | **FAIL 3/3**: `AssertionError: expected [ …(3) ] to have a length of 2 but got 3` (own worktree, install, build and ai build) |
| `src/gateway/server.chat-cli-auth.test.ts` (`vitest.gateway-server-isolated.config.ts`) | PASS 3/3 (5/5 each) | not run |
| `src/gateway/worker-environments/worker-turn-launcher.test.ts` (`vitest.gateway-database-workers.config.ts`) | PASS 3/3 (34/34 each) | not run |

Logs: `gates/ci-*.log`, `gates/pristine/e2e-compaction-{1,2,3}.log`.

## Red/green (`gates/redgreen.log`, script `gates/redgreen.sh`)

The script is merge4's `redgreen.sh` with only the `cd` line changed, plus RED14. All 14 target strings matched exactly once at the merge, checked before the run with `gates/rg-check.sh`, so I adapted nothing. For each mutation the mutated run failed, the restored run passed, and the checkout was clean afterwards.

| Mutation | Failing case when mutated | Restored |
|---|---|---|
| RED1 writer facts without the owner-check request | native-login > covers a SessionManager append only while the native login owner holds | 22/22 |
| RED2 metadata host never answers the owner probe | same | 22/22 |
| RED3 only a fresh recovery prompt is strict | execute.native-history-owner > spawns nothing for a resumed turn that replays history under another login (1/4) | 4/4 |
| RED4 UserPromptSubmit answer on the stream check alone | cli-runtime > withholds private turn context when the private-input check fails after the prompt was sent (1/53) | 53/53 |
| RED5 attestation without the opt-in | prepare-native-history > never sends the native token to Anthropic unless the operator opted in (1/3) | 3/3 |
| RED7 credential-root split guard removed | compat > reads the child's API key helper and secure-storage split (1/28) | 28/28 |
| RED8 CLAUDE_CODE_OAUTH_TOKEN dropped | compat > has no owner when the child selects CLAUDE_CODE_OAUTH_TOKEN instead of the stored login (1/28) | 28/28 |
| RED9 profile request without its timeout | compat > sends only the access token, only to the Anthropic profile endpoint, bounded (1/28) | 28/28 |
| RED10 strictness keyed on a resumed session id | execute.native-history-owner > spawns nothing for a fresh recovery turn whose environment selects another login (1/4) | 4/4 |
| RED11 a throwing lookup escapes | native-login > treats a login lookup that throws as no owner at every check (1/22) | 22/22 |
| RED12 throw caught only at the coverage check | same case | 22/22 |
| RED13 `nativeLoginOwnerHash` dropped from `createCliLiveSessionCapability` | cli-live-session-registry > does not reuse a warm process across a native login owner change (1/39) | 39/39 |
| **RED14 (new)** the 4 fix lines removed from `session-prompt-state.ts` | run.session-prompt-state > drops a retained compaction continuation once its internal prompt is persisted (1 failed / 16) | 16/16 |
| GREEN, seven owning files unmutated | 16 + 28 + 68 + 53 = 165 passed (merge4 149 + 16) | |

## Harness (`harness/`)

- `~/work/pr-164796-h/harness` was copied without `runs` to `~/work/m5-harness`, which has the same path length as `m4-harness`.
- The drivers in `harness/scripts/` are merge4's with only `m4-harness` -> `m5-harness` and `pr-164796-merge4` -> `pr-164796-m5` changed.
- Release installs: `~/work/pr-164796-h/release` (2026.10.4) and `release-1005` (2026.10.5), read only.
- The dist came from the gates' `pnpm build` at this tree. All three drivers exited 0 (`harness/drv.txt`).
- The six `Killed: 9` lines in `harness.log` are the probe's own Gateway teardown. merge4's log has the same six.

`harness/compare.txt` (reference = merge4 `harness/outcomes-after.txt`, `<` = merge4, `>` = this run):

- **Every outcome field is identical** after the exit-race mask: turn exit codes, delivered message sizes, fresh/resume modes, PINEAPPLE/BANANA/MANGO counts, boundaries and stub profile request counts, across all 39 rows.
- **The only difference is a uniform -323 bytes in every `+ctx` byte count from the tree under test**: 1310 -> 987, 1145 -> 822, 1312 -> 989, 1398 -> 1075, and so on. The 2026.10.4 and 2026.10.5 release arms' `ctx669` values are unchanged.
  - **Cause, explained:** main `23c99ef8740` (#178108, "fix(agents): correct reply guidance for routeless turns"). It is in 051bf6fa4d0 but not in merge4's main 79506514289.
  - It rewrote `buildHarnessVisibleReplyGuidance` (`src/auto-reply/source-reply-delivery-mode.ts`) for turns without a source conversation, and the harness turns are such turns.
  - The old delivery guidance (308 bytes) + target guidance "`send`: `message`; current source is default target..." (81) + message-tool pending-reply guidance (321) = 710 bytes. The new text is "This turn has no current conversation..." (153) + "`send`: `target` + `message`; target required this turn." (56) + the final-response pending guidance (178) = 387 bytes. 710 - 387 = **323**, the observed shift.
  - The text is produced by main, not the PR, and the PR does not touch that file. I read the captured context of `after-allowed` (987 bytes) before cleanup: it contains the new main text verbatim.
- **The turn-2 client exit-code race** (1 vs 143) differs unmasked in two `interrupted-*` rows vs merge4: `interrupted-fresh` (143 -> 1) and `interrupted-revoke-before-context` (1 -> 143). This is the known race, masked.
- **`outcomes-upgrade-1005.txt` differs only by the same -323 in its two tree-under-test ctx counts** (1145 -> 822, 1312 -> 989). Its release turns (`ctx669`) are unchanged.

Verdict: no behavioral difference. The single non-race difference is fully explained by main's #178108 prompt text.

## Bundle

- `merge.bundle` = `git bundle create merge.bundle d20c06b61fb..pr-m5 ^051bf6fa4d0`.
- Head `refs/heads/pr-m5` = `af1d1ce4a2aee17f413256a4241a9c9f9b4c4e0d`.
- Prerequisites: `d20c06b61fb2206cb6c97802732124cda6edd394` (from `compaction-fix/fix.bundle`) and **main `051bf6fa4d05e0870d0f360aee7ac1643cbb787d`, which must be fetched**.
- `git bundle verify`: `merge.bundle is okay` (`gates/bundle-verify.txt`). 5058 bytes, sha256 `34217688d22052ee7b16ba44fb06b054eaab150640738608fbb6831340c65d48`.
- To apply: in a clone holding 53ff5be1f3b, run `git fetch <dir>/compaction-fix/fix.bundle fix-pr:fix-pr`, fetch origin main `051bf6fa4d0`, then run `git fetch <dir>/merge5/merge.bundle pr-m5:pr-m5`. Check that `pr-m5^{tree}` = `76779f6d8d2`, then sign and push.

## Nothing unexplained

- The config/sessions lane flake passes alone and on rerun, and the lane totals are identical to main.
- Both check:changed failures are identical on pristine main.
- The harness ctx shift is main's #178108 text, accounted for byte for byte.
- The exit-code differences are the known race.
