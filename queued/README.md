# 164796 evidence: queued reassignment (owner confirmed inside the coverage transaction)

Captures behind the "Queued reassignment" evidence in openclaw/openclaw#164796, from one sitting on one Mac Studio.

- BEFORE: `c276e5e3b6cc5769678afb654fdeff87da92ce58`, the published head with the owner confirmed on the host before the worker command is dispatched (`gates/head-before.txt`). Harness label `base`.
- AFTER: `69861729ddf1e3b8e66ad6677ab61784a37437ac`, one commit on top of BEFORE (`gates/head-after.txt`, tree `83f1df415e1a6e72b56e4d577d064eb86f849701`). Harness label `after`.
- Paths are redacted: `$RUN` is a scenario run dir, `$H` the harness dir, `$W` a work tree, `$WORK` the work dir, `$HOME` the home dir.
- No real token, account uuid or email is stored here. The harness uses synthetic tokens `synthetic-<account>`. No real Claude, no real Anthropic request and no production Gateway, config or credential were involved.

## What is real and what is synthetic

Real: the built `openclaw agent --local` (`dist`), a real SQLite session database and its worker thread, real native-login files on disk, the production Claude runtime and stream-json transport, the production history boundary and worker coverage commit.

Synthetic: the `claude` executable (`harness/bin/claude`), the Anthropic profile endpoint (`harness/profile-stub.mjs`, reached through `harness/shim/profile-fetch-shim.mjs`), and the moment the login changes (`harness/shim/queued-switch-shim.mjs`).

`queued-switch-shim.mjs` wraps `Worker.prototype.postMessage` in the openclaw process. When the host posts the Nth `session.turn.commit` command to the SQLite worker it runs the "switch to account B" script synchronously, right after the post. The worker has not opened its transaction yet and the host has not yet serviced its admission request, so the login changes while that command is queued. Production code is unchanged.

## Layout

- `queued-reassign/`: the new scenario, BEFORE and AFTER.
  - `summary-base.txt`, `summary-after.txt`: openclaw log lines, the synthetic child's records (which account its login and credential named at each step), prompt canaries per delivered user message.
  - `boundary-by-turn-base.txt`, `boundary-by-turn-after.txt`: the stored `cliHistoryBoundary` after each turn.
  - `worker-commands-*.txt`: the worker commands queued, and the moment the login was switched.
- `outcomes-all-scenarios.txt`: one line per scenario and tree for all 22 scenarios. `diff` against the previous AFTER column (`c276e5e3b6c`) differs only by the added `queued-reassign` line: scenarios 1 to 21 are unchanged.
- `harness/`: scripts and per-run records. `runs/tipbuild-queued-reassign` is scenario 22 re-run after the tip's own incremental build (the other runs used the `dist` built just before the commit); it matches AFTER exactly (boundary `maxSeq` 3 after turn 2, turn 3 refused, 50 chars) (`runs/<base|after>-<scenario>/`: `turns.log`, `fake-claude.log`, `turn<N>.err`, delivered prompts, `transcript-and-boundary.txt`, `boundary-by-turn.txt`). `attrib-after-keychain-allowed` is scenario 10 re-run with caller stacks.
- `keychain/callsites-after.txt`: lookups per turn by caller (10 per turn, the same budget as before).
- `redgreen/`: the new test files run alone against BEFORE's production code (`*.base.log`).
- `mutations/`: ten mutations of the new check, each run alone (`results-batch1.json`, `results-batch2.json`, `muts-all.json`, per-mutation `.diff.txt`, `.failed.txt` and `logs/`, `run-muts.py`). Batch 2 re-ran `q10` after a test was added for it.
- `gates/`: `check:changed --timed`, oxlint on the changed files, the targeted tests, the two owning-directory lanes, `git diff --check`, the docs checks and the incremental build. Each `.log` starts with its command and ends with `# exit=<code>`; `index.txt` lists them.
- `SHA256SUMS`: hashes of every file here.

## Reproduce

```
git worktree add before c276e5e3b6c; git worktree add after 69861729ddf
(cd <each> && pnpm install --frozen-lockfile && pnpm build)
harness/scenario.sh <before-tree> base queued-reassign
harness/scenario.sh <after-tree> after queued-reassign
harness/summarize.sh <label> queued-reassign
```

The harness expects to live at `$HOME/work/164796-d/harness` (`H=` at the top of each script) and writes only under its own `runs/`.
