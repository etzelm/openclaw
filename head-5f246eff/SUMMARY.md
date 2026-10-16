# openclaw/openclaw#164796 ported onto current main (round 14)

Result: READY, unsigned, not pushed. Everything ran on the Mac Studio node in `~/work/pr164796`.

- Base (gh/main = origin/main on GitHub at run time): `012bb1ccaf0b63696b2608599b1cf4ea869a4245` (265 commits past the `5afc3db70fa` the killed run merged).
- PR head merged: `5fd7205504de1f9999516913cff7c4223448c415`.
- Final HEAD: `dfd14597b12a2245cb10eb92abd9ff8cd6d04cd8`. **Final tree SHA: `81f50f8c4f2df2fbe57a2302f88c9b04b21a7123`.**
- Commits on top of base (`git bundle`: `pr-164796-r14.bundle`, `git bundle verify` ok, sha256 prefix 57df42598b6b):
  `5fd72055` PR head chain, `b9cb363bf66` earlier unsigned merge of 5afc3db (re-checked, kept), `79e9bb220c9` merge of 012bb1ccaf0, `dfd14597b12` port fixes. All unsigned; re-sign on the mini (tree above).
  Note: the old merge b9cb363bf66 stays in history. If a single merge commit is wanted, `git commit-tree 81f50f8c4f2d -p 5fd7205504d -p 012bb1ccaf0` yields the same tree.
- Diff vs base: 39 files, 3217 insertions, 390 deletions. Working tree clean.

## Conflicts and ports

This run (merge of 012bb1ccaf0 into the earlier merge):
- `docs/.generated/config-baseline.sha256`: took main's, then regenerated with `pnpm config:docs:gen` (hash now `204b4331...` for config-baseline.json; counts.json already matched). `pnpm config:docs:check` prints OK.
- `src/agents/sessions/session-manager-metadata.worker.ts`: main moved the backend into `bindSqliteWorkerDatabase` (it owns assertOpen/assertSettled/close). Took main's shape and re-applied the PR's `ownerProbe` (createCliHistoryOwnerProbe per command, `confirmsOwner` on the writer, `withOwnerProbe` on the transaction admission, reset in `finally`). No duplicate of main's open/settle logic.

Earlier merge b9cb363bf66 (conflict list from r13 `conflicts.txt`), each re-read against main's design this run:
- `src/agents/cli-runner/history-boundary.ts`: main's `captureSessionActorStorageOwner` / `memory` actor path kept; PR's native-login attestation (`resolveNativeCliLoginOwner`, gated by `isNativeCliLoginAttestationEnabled`) runs before planning and feeds `{credential, nativeLoginOwner}`; writer exposes `replaysHistory`, `checkNativeLoginBoundary`, `bindExecutionEnv`, `settleNativeLogin`, folded into main's async `assertReadable`. Overlong comment reflowed.
- `src/agents/cli-runner/execute.ts`: main's `assertCurrent: cliHistoryWriter.assertCurrent` (transports check private history at send time) kept; added `carriesSavedHistory`, `bindExecutionEnv` after the final env, `settleNativeLogin` in `finally`; env building uses new `execution-env.ts` `resolveCliChildEnv` (shared with history-boundary) instead of duplicating it.
- `src/agents/cli-runner/execute-process.ts`: took main's (prepareSpawn/prepareInput = async assertReadable). The PR's `assertBoundary`/`beforeSpawn` is dropped because main now does that itself. File is identical to base.
- `src/agents/cli-runner/execute-plugin.ts`: main's `await cliHistoryWriter?.assertReadable()` kept; PR adds host-internal `assertPrivateInputCurrent` (only for native-login writers) instead of the PR's old `assertStreamCurrent`/`assertBoundary` pair.
- `extensions/anthropic/cli.runtime.ts`: main's live-session code kept (conflict hunk took main); PR's `ClaudeCliExecuteContext.assertPrivateInputCurrent`, check before the prompt send, and withholding saved `additionalContext` from the UserPromptSubmit answer when the check fails.
- `src/agents/cli-runner/prepare.ts`: passes `preparedBackend` to the boundary and `replayableTarget(writer)` as `sessionTarget`. Folded into the existing lines (identity const, `historyAllowed` inlined) so the line-cap ratchet stays flat (1732 -> 1732).
- `src/config/sessions/cli-history-boundary.ts`: `assertReadable: () => void | Promise<void>` (main) plus PR's `confirmsOwner`, `CliExecutionHistoryWriter`, `cliHistoryWriterFacts`, owner probe helpers.
- `src/agents/sessions/session-manager-metadata-runtime.ts`, `-command.ts`: host answers the worker's `cliHistoryOwnerProbe` in `assertAdmission` right before the grant; command sends `cliHistoryWriterFacts(cliWriter)`.
- `src/agents/cli-runner/history-boundary.test.ts`: uses shared `createHistoryBoundaryFixture` (new `history-boundary.test-support.ts`) on main's incognito/`prepareSystemAgentRunAdmission` fixture.
- `src/agents/cli-runner/execute-plugin.test.ts`, `extensions/anthropic/cli-runtime.test.ts`: both sides' tests kept. `cli-runtime.test.ts` would have been 1064 lines against the 1000 cap, so the shared fixture moved to `cli-runtime.test-harness.ts` and the three PR tests to `cli-runtime.private-input.test.ts`.
- `docs/.generated/config-baseline.counts.json`: matches generator.
- Non-conflicting but touched by the PR: `session-accessor.sqlite-transcript-reports(.worker).ts`, `session-actor-memory-{events,transcript}.ts`, `session-turn(.worker).ts`, `session-accessor.sqlite-cli-history-boundary.ts`, `live-session-fingerprint.ts` (native owner hash), `types.ts`, `cli-credentials.ts`, `provider-auth-claude-compat.ts`: compiled and tested against main's APIs, no changes needed.

## Gates (all at HEAD dfd14597b12 unless noted; logs in `gates/`)

- Typecheck: `pnpm tsgo:core`, `pnpm tsgo:core:test`, `pnpm tsgo:extensions`, `pnpm tsgo:extensions:test`: all `EXIT 0` (`f-tsgo-*.log`). No conflict markers (`conflict markers` check ok).
- Targeted vitest (18 files, `f-targeted.log`): 33+143+56+40+13+111+60 = 456 tests, 0 failed, `[test] passed 7 Vitest shards`, `EXIT 0`.
- Lane `src/agents/cli-runner/`: `Test Files 12+2+7+37+1 passed`, 41+11+223+432+5 tests passed, EXIT 0.
- Lane `extensions/anthropic/`: `Test Files 36 passed (36)`, `Tests 395 passed | 1 skipped (396)`, EXIT 0 (includes the new private-input file, 3 tests).
- `src/plugin-sdk/provider-auth-claude-compat.test.ts`: `Tests 40 passed (40)`, EXIT 0.
- Lane `src/agents/sessions/` (at 79e9bb220c9, code unchanged since): 14+6+28+54 files passed, 1+0+0+1 skipped, 0 failed, EXIT 0.
- Lane `src/config/sessions/` (at 79e9bb220c9; none of its files changed since): `Test Files 1 failed | 362 passed | 1 skipped (364)`, `Tests 1 failed | 3198 passed | 1 skipped (3200)`. The failure:
  `FAIL runtime-config src/config/sessions/session-accessor.sqlite-archive-read.test.ts > SQLite transcript archive reads > reads a short final answer beyond the runtime string limit while the caller stays responsive` / `Error: Test timed out in 30000ms.`
  Pre-existing: the same lane on pristine gh/main 012bb1ccaf0 fails the same test identically (`Test Files 1 failed | 361 passed | 1 skipped (363)`, `Tests 1 failed | 3192 passed`, `main-lane-config-sessions.log`). The file passes alone on the PR tree (`Tests 6 passed (6)`). Not touched by the PR.
- `pnpm check:changed` (`f-check-changed.log`, base origin/main = 012bb1ccaf0): 42 ok, 2 failed, both reproduced on pristine main:
  1. `max-lines suppression ratchet`: `config/env-var-count-budget.txt: OPENCLAW_* count 452 is below budget 453; update config/env-var-count-budget.txt` (`check-env-var-count.mts` prints the same on main).
  2. `dead export scan`: `extensions/file-transfer/src/node-host/path-errors.ts: classifyFsSafeReadError` and `ui/src/pages/chat/components/chat-transcript.test-support.ts: TranscriptTestHost` (`check-deadcode-exports.mts` on main prints the same). Neither file is in the PR diff.
  Fixed during this run: line-cap ratchet (cli-runtime.test.ts, prepare.ts), oxfmt (2 files), config docs baseline, `lint extensions` max-lines. Now ok.
- The full `pnpm test` suite was not run, as instructed. Not run: e2e/live files (fenced on the studio).

## Mutation checks (`mutations/redgreen.log`, script `mutations/redgreen.sh`)

Each mutation applied alone, owning test run (must fail), file restored, same test run again (must pass), checkout clean.
- RED1 command sends writer facts without the owner-check request: `AssertionError: expected 2 to be 1` in history-boundary.native-login-metadata.test.ts, restored `Tests 1 passed (1)`.
- RED2 metadata host never answers the owner probe: `AssertionError: expected 0 to be greater than 0`, restored `1 passed`.
- RED3 execute.ts back to "only a fresh recovery prompt is strict": `spawns nothing for a resumed turn that replays history under another login` -> `promise resolved ... instead of rejecting`, restored `Tests 4 passed (4)`. (Mutation text updated for main's renamed variable.)
- RED4 UserPromptSubmit answer goes out on the stream check alone: `expected 'saved private context' to be undefined` in cli-runtime.private-input.test.ts, restored `Tests 3 passed (3)`. (Test file moved with the split.)
- RED5 native login attested without the operator opt-in: `expected { ...(12) } to be undefined` in prepare-native-history.test.ts, restored `Tests 6 passed (6)`.
- Unmutated run of the owning files: `Tests 11 passed (11)`, `Tests 3 passed (3)`, `git status --porcelain` 0 lines.

## Evidence harness (`harness/`)

Built both trees (`build-final.log`, `build-base.log`: BUILDEXIT 0). Ran the r13 harness (scenarios from `out/head-5fd72055/harness`, copied to the studio; exec bits restored) against the final tree (`runs/after-*`) and the base build (`runs/base-allowed`, `base-resumed-allowed`, attestation off). `outcomes-after.txt` has 37 lines (36 scenarios + header).
Compared with the previous round's `outcomes-after.txt` after normalizing context byte counts (main's own UserPromptSubmit context grew, 852->1145 and 1017->1310 chars) and the interrupted turn's exit code (143 here vs 1 there): identical for every scenario except `upgrade`, which was not run (needs an installed v2026.10.2 package, none on the studio). Base control matches the previous base (`t1:none t2:none`, `stubProfileRequests=0`).
Harness fix: main now transfers the worker command buffer, so `queued-switch-shim.mjs` read a detached buffer and `queued-reassign` silently did not reassign (first pass showed `t3:known/6`, a false "no refusal"). Fixed to decode before `postMessage` (`harness/queued-switch-shim.fixed.mjs`); rerun gives `t1:known/2 t2:known/3 t3:unknown`, as before. Product code untouched.

## Unresolved / notes

- `upgrade` scenario not re-run (no release package to install from). Not otherwise re-proven this round.
- `targeted` list in `f-targeted.log` predates the new private-input file; that file is covered by the `extensions/anthropic/` lane (36 files, pass) and RED4.
- ClawSweeper's earlier owner-decision cap (3/6) is a product matter and unchanged by this port.
- Cleanup: the Studio checkout `~/work/pr164796`, the base worktree `~/work/pr164796-main`, `~/work/pr164796-h` and `~/work/pr164796-logs` are removed after the bundle was verified.
