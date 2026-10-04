# 164796 evidence

Scripts, raw logs and summaries behind the evidence section of openclaw/openclaw#164796.

- harness/: scenario.sh (one scenario, two or three real `openclaw agent --local` turns against a built tree), bin/claude (a synthetic Claude child that speaks the stream-json control protocol, records every record that reaches it and the login it would run under, and can rewrite the login on disk at FAKE_ON_INIT or FAKE_ON_USER), run-matrix.sh (all eight scenarios), summarize.sh, summary-before.txt, summary-after.txt.
- runs/<label>-<scenario>/: turns.log (turn exit codes), fake-claude.log (child records, whole), turn<N>.err (OpenClaw log of the turn), fake-claude.log.user-<pid>-<n>.txt (the exact user message the child received).
- tests/: the targeted `pnpm test` command, the SHA it ran on, and its log.
- mutations/: one log per mutation and results.json with the failing test names.
- gates/: check-changed and ratchet logs, build timings, tool versions (evidence trees).
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
Final head: f32e17d4781359820beacdb536dea9a28f80857e (cff200f4dff, f32e17d4781) on base 83f4c296109bfebda1d25afdff13de238a522109.
