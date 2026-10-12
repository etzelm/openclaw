# 164796 evidence at the rebased head (base 5d840900899)

All captures in this folder ran on one Mac Studio at tree `76e11c8b4a9` (the pushed head), base `5d8409008994657646d7d97dcb0fca99900a0b57`.

- `harness/`: `scenario.sh` (one scenario: two to five real `openclaw agent --local` turns against a built tree), `scenario2.sh` (scenario 14), `run-all.sh`, `outcomes.sh`, `bin/claude` (synthetic Claude child: speaks the stream-json control protocol, records every record that reaches it and the login it would run under, rewrites the login at `FAKE_ON_INIT` / `FAKE_ON_USER`, and with `FAKE_WRITE_TRANSCRIPT=1` writes a native transcript so the next turn resumes), `profile-stub.mjs` (STUB of the Anthropic profile endpoint), `shim/` (profile URL redirect, Keychain shim, queued-command shim), `transcript.mjs` and `boundary.mjs` (read rows and the stored boundary from the agent database).
- `runs/after-<scenario>/`: `turns.log`, `turn<N>.err` (OpenClaw log of each turn), `fake-claude.log` (child records and stub requests, whole), `fake-claude.log.user-<pid>-<n>.txt` (the exact user message the child received), `boundary-by-turn.txt`, `transcript-and-boundary.txt`, `queued.log` (scenario 22), `doctor.out` and `config-*.json` (scenario 27). SQLite files, the synthetic home and the workspace are not included.
- `outcomes-after.txt`: one line per scenario.
- `gates/`: build timing, targeted tests, owning-directory lanes, red/green log, check-changed log, the base control for `src/plugin-sdk/channel-inbound.test.ts`.

Paths are redacted: `$RUN` is the scenario run dir, `$HOME` the home dir.

Identity: the captures ran in a local commit `4cccfd5a9bb` (tree `e31df11f419`); the pushed commit is the same tree, signed. `gates/identity.txt` records the tree before and after the run.
Base controls (`gates/base-control-*.log`) compare a failing test on `5d840900899` and on an earlier local commit of this branch whose diff to the pushed tree is a docs sentence and two lint fixes; neither file is touched by the PR.
