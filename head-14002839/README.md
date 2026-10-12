# 164796 evidence at head 14002839 (base 5d840900899)

All captures in this folder ran on one Mac Studio at tree `52b75bd3612` (head `140028391cd`, base `5d8409008994657646d7d97dcb0fca99900a0b57`), except `runs/before-05501c8a-*`, which ran the built `dist` of the previous head `05501c8acd9` (tree `e31df11f419`) with the same harness.

- `harness/`: the scenario harness (see `../rebased-5d840900/README.md` for each file), plus `round3.sh` (the whole capture sequence for this head), `redgreen.sh`, `record3.sh` with `child3.py` (one readable record per run) and `upgrade3.sh` (the upgrade record).
- `runs/after-<scenario>/`: per turn OpenClaw log, child records (`fake-claude.log`, whole), the exact user message (`.user-*`) and `UserPromptSubmit` context (`.context-*`) the child received, the stored boundary after each turn, transcript rows. SQLite files, the synthetic home and the workspace are not included.
- `runs/before-05501c8a-interrupted-{reassign,revoke}-before-context/`: the same two scenarios at the previous head.
- `outcomes-after.txt`: one line per scenario.
- `gates/`: identity, build, harness log, targeted tests, owning-directory lanes, red/green, check-changed, other checks, and the records quoted in the PR body (`rec-*.txt`).

Paths are redacted to `$RUN` and `$HOME`. Tokens in the harness are synthetic (`synthetic-<account>`).
