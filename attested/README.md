# 164796 evidence (attested native login owner)

Captures behind the evidence section of openclaw/openclaw#164796, from one sitting on one Mac Studio.

- AFTER: commit `c276e5e3b6cc5769678afb654fdeff87da92ce58`, tree `bb3db4d6d39c27f4a250e11de1c408a6ad1d8cf4` (`gates/head-after.txt`).
- RECORD: commit `769c35116e0a018a2a450c6250719e50f3f9c992`, the same branch with the native owner read from the `.claude.json` account record.
- BEFORE: base `0816aa1b57dc815d0c1e0d48bcb9517980985438` (main without this PR).
- Paths are redacted: `$RUN` is a scenario run dir, `$H` the harness dir, `$W` a work tree, `$HOME` the home dir, `$TMPDIR` the temp dir.
- No real token, account uuid or email is stored here. Synthetic tokens are `synthetic-<account>` (harness) or `token-<account>-<uuid>` (unit tests). The one real attestation keeps only a 12-hex SHA-256 prefix of the account uuid.

## Layout

- `identity/`
  - `real-profile-attestation.txt` and `real-profile-probe.mjs`: one real `GET https://api.anthropic.com/api/oauth/profile` with a logged-in Claude CLI account's token, plus one with a synthetic token. The output keeps status, latency, key shape and hash prefixes.
  - `refresh-timing.txt` and `refresh-timing-probe.sh`: when the real Claude CLI 2.1.283 refreshes an expired token relative to the stream-json `initialize` answer. All connections went to a refusing local proxy.
- `harness/`: the real-binary harness.
  - Entry points: `scenario.sh` (scenarios 1 to 13 and 15 to 21), `scenario2.sh` (scenario 14), `run-all.sh`, `summarize.sh` and `summarize-keychain.sh`.
  - `bin/claude`: the synthetic Claude child. It records each record it receives, plus the account named by the login's record (`loginAccount`) and by its credential (`credentialAccount`).
  - `profile-stub.mjs`: a STUB of the Anthropic profile endpoint.
  - `shim/profile-fetch-shim.mjs`: redirects only the profile URL to the stub.
  - `shim/security-shim.mjs`: the Keychain shim at the `child_process.execSync` seam. Set `FAKE_SECURITY_STACKS=1` to record a caller stack per lookup.
  - `transcript.mjs` and `boundary.mjs`: read a run's transcript rows and stored boundary.
  - `attrib.py`: groups shimmed lookups by caller.
- `runs/<base|prev|after>-<scenario>/` (`prev` is RECORD):
  - `turns.log`: turn exit codes.
  - `fake-claude.log`: child records and the stub's request log, whole.
  - `turn<N>.err`: the OpenClaw log of each turn.
  - `fake-claude.log.user-<pid>-<n>.txt`: the exact user message the child received.
  - `transcript-and-boundary.txt`: the transcript rows and the stored boundary after the last turn.
  - `runs/attrib-after-keychain-allowed/` is scenario 10 re-run with caller stacks.
- `summaries/`: `summary-<tree>.txt` (every scenario, whole records) and `outcomes.txt` (one line per tree and scenario).
- `keychain/callsites-after.txt`: lookups per turn by caller.
- `redgreen/`: the new and changed test files, each run alone against RECORD's production code (`redgreen.sh`, per-file `.log` and `.exit`).
- `mutations/`:
  - `muts-batch1.json` and `muts-batch2.json`: each mutation's file, old text, new text and owning tests.
  - `results-batch*.json`: exit codes per test file.
  - `summary-batch*.txt`.
  - `<id>.diff.txt` and `<id>.failed.txt`.
  - `logs/<id>.<test>.log`.
  - `run-muts.py`.
  - Batch 1 ran at `81c7ddbf5f6`, whose production files are identical to AFTER's: `git diff 81c7ddbf5f6 c276e5e3b6c -- . ':!*.test.ts'` is empty. Batch 2 ran at AFTER.
- `gates/`: `check:changed --timed`, `lint:core`, the docs checks, `git diff --check`, `changed:lanes --json` and the build phase timings for all three trees. Each `.log` starts with the command, and each `.exit` holds its exit code.
- `lanes/`: the targeted set and the owning-directory lanes (`src/agents/cli-runner/`, `extensions/anthropic/`, `src/config/sessions/`, the provider-auth files), each under `/usr/bin/time -p`.

## Reproduce

```
git worktree add before 0816aa1b57dc; git worktree add record 769c35116e0; git worktree add after c276e5e3b6c
(cd <each> && pnpm install --frozen-lockfile && pnpm build)
harness/run-all.sh <tree> <label>; harness/scenario2.sh <tree> <label> skill-config-dir-added
harness/summarize.sh <label> <scenario>
```

The harness expects to live at `$HOME/work/164796-c/harness` (`H=` at the top of each script).
