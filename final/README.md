# 164796 evidence (final)

Captures behind the evidence section of openclaw/openclaw#164796, from one sitting on one Mac Studio.

- AFTER: commit `769c35116e0a018a2a450c6250719e50f3f9c992`, tree `22915caa698841c287bbc65d643383621f13b322` (`gates/head.txt`).
- BEFORE: base `0816aa1b57dc815d0c1e0d48bcb9517980985438` (main without this PR).
- Paths are redacted: `$RUN` is a scenario run dir, `$H` the harness dir, `$W` a work tree, `$HOME` the home dir, `$TMPDIR` the temp dir.

## Layout

- `harness/`: `scenario.sh` (scenarios 1 to 13: two to three real `openclaw agent --local` turns against a built tree), `scenario2.sh` (adds scenario 14, `skill-config-dir-added`), `run-all.sh`, `summarize.sh`, `summarize-keychain.sh`, `bin/claude` (synthetic Claude child that speaks the stream-json control protocol and records every record that reaches it with the login its files name at that instant), `shim/security-shim.mjs` (Keychain shim preloaded at the `child_process.execSync` seam; `FAKE_SECURITY_STACKS=1` adds a caller stack per lookup), `rows.mjs` / `boundary.mjs` / `transcript.mjs` (read transcript rows and the stored history boundary from a run's session database), `attrib.py` (groups shim lookups by caller), `bench.sh` (wall time and max RSS per turn).
- `runs/<base|after>-<scenario>/`: `turns.log` (turn exit codes), `fake-claude.log` (child records, whole), `turn<N>.err` (OpenClaw log of the turn), `fake-claude.log.user-<pid>-<n>.txt` (the exact user message the child received), `transcript-and-boundary.txt` (transcript rows with their fields and the stored boundary after the last turn). `runs/attrib-after-keychain-allowed/` is scenario 10 re-run with caller stacks.
- `summaries/`: the summaries quoted in the PR body, both trees.
- `keychain/`: `callsites-after.txt` (lookups per turn by caller), `latency.txt` and `lat.mjs` / `lat.sh` (real `/usr/bin/security` latency; the readable rows use a synthetic item in a throwaway keychain that the script creates and deletes), `turn-bench.txt` (three repetitions per tree, `/usr/bin/time -l`).
- `identity/`: `claude-auth-status-probe.txt` and `.sh` (real Claude CLI 2.1.283 against synthetic login files; the script as run, with the scratch path generalized), `refresh-rotation.txt` (one real token refresh, hash prefixes only), `cli-bundle-excerpt.txt` (byte excerpts of the 2.1.283 bundle).
- `mutations/`: `muts-final.json` (each mutation: file, old, new, owning tests), `results-final.json` (exit codes and failing test names), `summary-final.txt`, `<id>.diff.txt`, `<id>.failed.txt`, `logs/<id>.<test>.log`.
- `gates/`: targeted tests, `check:changed --timed`, `lint:core`, docs checks, `git diff --check`, `changed:lanes --json`, build phase timings for both trees, and the touched Gateway test file's before/after timing. Each `.log` starts with the command; each `.exit` holds its exit code.
- `lanes/`: the owning-directory lanes (`src/agents/cli-runner/`, `extensions/anthropic/`, `src/config/sessions/`, the provider-auth files), each with `/usr/bin/time -p`.

## Reproduce

```
git worktree add before 0816aa1b57dc && (cd before && pnpm install --frozen-lockfile && pnpm build)
git worktree add after 769c35116e0 && (cd after && pnpm install --frozen-lockfile && pnpm build)
harness/run-all.sh <before> base && harness/run-all.sh <after> after
harness/scenario2.sh <tree> <label> skill-config-dir-added
harness/summarize.sh <label> <scenario>; harness/summarize-keychain.sh <label> <scenario>
```

The harness expects to live at `$HOME/work/164796-harness` (`H=` at the top of each script).
