# #164796 CI: `test/gateway-openai-compaction-replay.e2e.test.ts` root cause and fix

Studio, 2026-10-20. Checkout `~/work/pr-164796-cr` (blob:none clone, now deleted).

## Verdict

- **Main bug, not fixed on main.** Newest main `e12719836f8` (2026-10-20 15:38 UTC) still fails 3/3 with the same assertion.
- **Culprit:** `07b59a0976d` "fix: rate-limited runs lose the prompt cache on retry" (#177050, Ayaan Zaidi, 2026-10-19). Found by `git bisect run` from good `7525fae0d51` to bad `79506514289` (1757 commits, 11 steps; `logs/bisect-log.txt`, `logs/bisect-steps.txt`). Parent `808cb5d124c` passes and `07b59a0976d` fails.
- **Fix:** commit `d20c06b61fb` on top of PR head `53ff5be1f3b`. It touches 2 files: production +4/-0, test +12/-0. Unsigned, author and committer "Mitchell Etzel <etzelm@users.noreply.github.com>". There is no main merge.
- No product decision is needed, and no maintainer is rewriting this code right now. `session-prompt-state.ts` was last changed by #176804 and #175837. No open PR touches the retention.

## Mechanism

1. Request 1 returns only a compaction item, with status `incomplete`. In `terminal-resolution.ts`, `activateCompactionContinuation` stores `COMPACTION_CONTINUATION_RETRY_INSTRUCTION` as the retained `compactionContinuationInstruction` in `session-prompt-state.ts`. That retention came from #136236 (`fb716dcd6ed`, "retain compaction continuation across retries"). At that time internal retry prompts were never saved, so later invisible retries had to carry the instruction again.
2. Request 2 sends the compaction instruction as an internal prompt and gets a reasoning-only answer back.
3. Since #177050, `attempt-prompt-submit.ts` submits an internal prompt with persistence mode `"runtime"`. `session-tool-result-guard.ts` then saves it as a hidden `internal_system` row and fires `onUserMessagePersisted`. So request 2's compaction prompt is now part of the transcript.
4. The reasoning-only retry calls `activateInternalPrompt(reasoning instruction)`. The `activePrompt.override` getter still appends the retained instruction (`${base}\n\n${instruction}`).
5. Request 3 therefore carries the compaction continuation twice: once replayed from history (request 2's row) and once appended to the new retry prompt. That matches the observed `split(...).length === 3`. Request dump: `logs/requests.json`.

#177050's PR body names this exact risk: "If it is wrong, the model would see an extra hidden continuation prompt in replayed history." Its evidence lanes did not include this e2e test. It is a `test/` e2e file, and main push CI skips that shard. The test runs on #164796 only because the PR's changed-file shard selects it.

## Fix

The retained instruction is dropped once the internal prompt that carries it has been persisted. From then on, history replays it. Retention still covers retries whose prompt never reached the transcript (pre-submit failures, blocked prompts). That keeps the existing unit test "retains compaction continuation across reasoning and empty retries" green unchanged.

```diff
--- a/src/agents/embedded-agent-runner/run/session-prompt-state.ts
+++ b/src/agents/embedded-agent-runner/run/session-prompt-state.ts
@@ -154,6 +154,10 @@ export async function createEmbeddedRunSessionPromptState(input: {
   const onUserMessagePersisted: NonNullable<
     RunEmbeddedAgentParamsWithSessionFile["onUserMessagePersisted"]
   > = (message) => {
+    // A persisted internal prompt replays its compaction instruction from history.
+    if (activePrompt.internal) {
+      clearCompactionContinuation();
+    }
```

The regression test is in `run.session-prompt-state.test.ts`: "drops a retained compaction continuation once its internal prompt is persisted". Before persistence the override is `visible-answer retry\n\ncontinue after compaction`. After `onUserMessagePersisted`, the next retry's override is just `empty-response retry`.

Why this line is safe: `activePrompt.override` is read once per attempt, at dispatch (`run-attempt-dispatch.ts:98`), before submission. Clearing it during persistence cannot change the attempt that is running. With `activePrompt.internal` set, the submit path always uses `"runtime"` persistence, so the persisted row is exactly the prompt that carried the instruction.

pr-simplify verdict:
- The fix is one owner (session-prompt-state) and 4 production lines.
- Removing retention outright would also be net-negative, but I rejected it. It would drop the constraint for pre-persistence retries and contradict the existing #136236 unit contract.
- No new state, helpers or exports.
- The test group has one named failure: re-appending the instruction after persistence. It is red without the fix.

## Red/green

| Tree | e2e result (3 runs) | Logs |
|---|---|---|
| main `e12719836f8` | FAIL 3/3, `expected [ …(3) ] to have a length of 2 but got 3` | `logs/main-e12719836f8/newmain-{1,2,3}.log` |
| main `e12719836f8` + fix (working tree) | PASS 3/3 | `logs/main-e12719836f8/mainfix-{1,2,3}.log` |
| PR head `53ff5be1f3b` | FAIL 3/3, same assertion | `logs/gates/e2e-head-{1,2,3}.log` |
| PR + fix `d20c06b61fb` (tree `45cac6fa3ac`) | PASS 3/3 | `logs/gates/e2e-fix-{1,2,3}.log` |
| bisect: `7525fae0d51` good, `808cb5d124c` good, `07b59a0976d` bad | 1 run each | `logs/bisect/` |

Unit red/green: the new unit test fails on main source with the test applied (`expected 'empty-response retry\n\ncontinue afte…' to be 'empty-response retry'`, `logs/unit-red.log`) and passes with the fix (16/16).

Every arm rebuilt dist (`pnpm build` plus `tsdown.ai.config.ts`) before its e2e runs, with `OPENCLAW_VITEST_RUNTIME=node OPENCLAW_E2E_USE_PREBUILT_DIST=1`.

## Gates on the final tree `d20c06b61fb` (`logs/gates/gates.txt`)

```
build fix rc=0
build-ai fix rc=0
e2e fix run 1-3 rc=0  Tests 1 passed (1)
lane src/agents/embedded-agent-runner/ rc=0  Test Files 116 passed (116)  Tests 1541 passed (1541)  [test] passed 7 Vitest shards in 673.51s
pnpm tsgo:core rc=0
pnpm tsgo:core:test rc=0
pnpm tsgo:extensions rc=0
pnpm tsgo:extensions:test rc=0
targeted PR files rc=0 [test] passed 5 Vitest shards in 69.58s
madge rc=0 Madge import cycle check: 0 cycle(s).
oxfmt --check (38 files vs 79506514289) rc=0 Finished in 15ms on 35 files using 32 threads.
git diff --check 53ff5be1f3b..HEAD rc=0
type-aware oxlint (2 changed files) rc=0, 0 warnings and 0 errors (logs/gates/oxlint.log)
server.chat-cli-auth run 1-3 rc=0  Tests 5 passed (5)        [vitest.gateway-server-isolated.config.ts]
worker-turn-launcher run 1-3 rc=0  Tests 34 passed (34)      [vitest.gateway-database-workers.config.ts]
```

- The targeted PR files were: `src/agents/cli-runner/{history-boundary.native-login,prepare-native-history,execute.native-history-owner,history-boundary.incognito,history-boundary,execute-plugin,cli-live-session-registry}.test.ts`, `src/agents/cli-credentials.test.ts`, `src/plugin-sdk/provider-auth-claude-compat.test.ts` and `extensions/anthropic/cli-runtime.test.ts`.
- **The other two CI failures pass locally 3/3.** I ran them on `d20c06b61fb`, which differs from `53ff5be1f3b` only by the two `embedded-agent-runner` files. They do not reproduce on the Studio, so treat them as CI-environment or flake signals, not as evidence against the PR.
- The studio load average was about 25 to 30 during the lane. It still passed cleanly.
- `check:changed` was not run. It was not in the requested gate list.

## Line deltas

- This commit, against PR head `53ff5be1f3b`: production +4/-0 (`session-prompt-state.ts`), test +12/-0 (`run.session-prompt-state.test.ts`, 693 to 705 lines, under the 1000-line test cap).
- The whole PR delta grows by the same 16 lines.

## Deliverables

- `fix.patch`: `git format-patch` of `d20c06b61fb`. sha256 `541c4d3e9595e3d369b99ff8485ed2452813a5a563aa59595ce8488fbf155245`.
- `fix.bundle`: `53ff5be1f3b..fix-pr` (tip `d20c06b61fb2206cb6c97802732124cda6edd394`). Its only prerequisite is `53ff5be1f3b1887519fce52dc145323c2d671817`. No main SHA needs fetching. sha256 `90cc9de0cfd68a69345c168a089edaeb1809895033fe7b3003ae8fc87623afaf`.
- `logs/`: bisect, red/green, gates, request dump, and the scripts used (`run-arm.sh`, `bisect-step.sh`, `gates.sh`).

To apply: `git fetch <dir>/fix.bundle fix-pr:fix-pr` in a clone holding `53ff5be1f3b`, then sign and push. The commit is unsigned.

## Suggested PR-body note

The e2e failure is pre-existing on main since #177050. This commit fixes it at its owner, so the PR's selected e2e shard goes green. It could also land as its own PR against main, since the patch applies cleanly to `e12719836f8` and was proven there 3/3.
