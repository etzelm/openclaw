# 164796 evidence

Scripts, raw logs and summaries behind the evidence section of openclaw/openclaw#164796.

- harness/: scenario.sh (one scenario, two or three real `openclaw agent --local` turns against a built tree), bin/claude (a synthetic Claude child that speaks the stream-json control protocol, records every record that reaches it and the login it would run under, and can rewrite the login on disk at FAKE_ON_INIT or FAKE_ON_USER), run-matrix.sh (all eight scenarios), summarize.sh, summary-before.txt, summary-after.txt.
- runs/<label>-<scenario>/: turns.log (turn exit codes), fake-claude.log (child records, whole), turn<N>.err (OpenClaw log of the turn), fake-claude.log.user-<pid>-<n>.txt (the exact user message the child received).
- tests/: the targeted `pnpm test` command, the SHA it ran on, and its log.
- mutations/: one log per mutation and results.json with the failing test names.
- gates/: check-changed and ratchet logs, build timings, tool versions (evidence trees).
- r2/: round 3 (Keychain fix). r2/harness has the Keychain shim (shim/security-shim.mjs), scenario.sh with the Keychain scenarios, run-keychain.sh, summarize-keychain.sh and the summaries (summary-keychain-before.txt, summary-keychain-after.txt, summary-after-eight.txt); r2/runs/<label>-<scenario>/ holds the raw records of scenarios 9 to 12 (before and after) and of scenarios 1 to 8 re-run on 15cc65fa155.
- gates/r2/ and mutations/r2/: targeted tests, check-changed, tsgo:core:test, ratchets, build timings, rebase-proof2.txt and the Keychain mutation logs for the final head.
- gates/rebased/: the targeted tests, check-changed, `pnpm tsgo:core:test` and ratchet logs on the final rebased head, plus rebase-proof.txt (git range-diff and the file-overlap check).

Paths are redacted: $RUN is the scenario run dir, $W the work dir, $HOME the home dir.
BEFORE is bf11340aa00 (de1dc67b0c27 rebased onto b7645ddfada). AFTER is 0c6c234c0b3, same base.

Relative links (valid from the root of this folder, wherever it is pushed):
[harness/summary-before.txt](harness/summary-before.txt),
[harness/summary-after.txt](harness/summary-after.txt),
[harness/scenario.sh](harness/scenario.sh),
[harness/bin/claude](harness/bin/claude),
[mutations/results.json](mutations/results.json),
[tests/final-tests.log](tests/final-tests.log),
[gates/rebased/rebase-proof.txt](gates/rebased/rebase-proof.txt),
[gates/rebased/tests.log](gates/rebased/tests.log),
[gates/rebased/check.log](gates/rebased/check.log),
[gates/rebased/tsgo-core-test.log](gates/rebased/tsgo-core-test.log).
Final head: 4ff780ae65151ba06758b67303d2b408257ab471 (21438af303b, 2f0db5685fa, 4ff780ae651) on base 0816aa1b57dc815d0c1e0d48bcb9517980985438. Earlier rounds' captures are kept in place.
[r2/harness/summary-keychain-before.txt](r2/harness/summary-keychain-before.txt),
[r2/harness/summary-keychain-after.txt](r2/harness/summary-keychain-after.txt),
[r2/harness/summary-after-eight.txt](r2/harness/summary-after-eight.txt),
[r2/harness/shim/security-shim.mjs](r2/harness/shim/security-shim.mjs),
[gates/r2/rebase-proof2.txt](gates/r2/rebase-proof2.txt),
[gates/r2/tests.log](gates/r2/tests.log),
[gates/r2/check.log](gates/r2/check.log),
[mutations/r2/results.json](mutations/r2/results.json).
