# 164796 evidence at head 5fd72055 (base 02368839f49)

All captures in this folder ran on one Mac Studio. Tests, lanes, check:changed, red/green and lint ran at the pushed tree `7faff7483d7` (head `5fd7205504d`, base `02368839f4994a4e9d9a843fcd605ffe6c5912cf`). The scenario harness ran on the build of tree `544b2f52a7d`, which differs from the pushed tree only in `src/agents/cli-runner/history-boundary.native-login-metadata.test.ts`; the pushed tree was rebuilt afterwards and both `dist` trees were hashed file by file (`gates/dist-hashes.diff`). `runs/base-*` ran a build of `02368839f49` itself.

- `harness/`: the scenario harness (see `../rebased-5d840900/README.md` for each file). New here: `optin.mjs` sets or removes `plugins.entries.anthropic.config.historyRecovery.attestNativeLogin` in the run's `openclaw.json`; every scenario sets it to `true` except `optout-allowed`, `optin-withdrawn` (removed before turn 2), `optin-later` (set before turn 2) and the base runs (`HARNESS_ATTEST=0`, the base schema has no such key). `upgrade` sets it only after `doctor --fix`. `round-p3.sh`, `harness-p3.sh` and `round-p3b.sh` are the capture sequence; `record3.sh`, `upgrade3.sh` and `record-p3.py` print the records quoted in the PR body.
- `runs/after-<scenario>/`, `runs/base-<scenario>/`: per turn OpenClaw log, child records (`fake-claude.log`, whole), the exact user message (`.user-*`) and `UserPromptSubmit` context (`.context-*`) the child received, the stored boundary after each turn, transcript rows, the run's `openclaw.json`. SQLite files, the synthetic home and the workspace are not included.
- `outcomes-after.txt`, `outcomes-base.txt`: one line per scenario.
- `gates/`: identity, both builds and the dist hash comparison, harness logs, targeted tests, owning-directory lanes, red/green, check-changed, other checks, and the records quoted in the PR body (`rec-*.txt`).

Paths are redacted to `$RUN` and `$HOME`. Tokens in the harness are synthetic (`synthetic-<account>`).
