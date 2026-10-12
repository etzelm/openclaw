# PR 165112 evidence, round 3

Code under test: tree `3b7b5a8e59a55a20e5c6b89e4059813a84a88a15` (pushed head of `fix/converged-roster-workspace-pin`), base `16d913005f9`. On the test machine it was the rebased branch plus uncommitted working-tree changes whose tree equals the pushed head; `pnpm build` and the candidate package report that checkout's local commit as `5fbcd9f`. Header lines in `updater/*/updater-*.out` print `base 04914b1ab80`: that is the upstream ref fetched later for the hash table, not the base of the code under test.

Every run uses an isolated profile (temp `HOME`, `OPENCLAW_HOME`, state directory), a loopback Gateway, the repo's scripted OpenAI-compatible mock provider and a synthetic key. Paths are redacted to `<profile>`, `<work>`, `<repo>`, `<tmp>`, `~`.

- `cases/`: eight real `openclaw doctor` and `doctor --fix --non-interactive` runs with Gateway turns before and after (root, subdir, neither, both, agentsmd, env, tilde, include). `<case>.out` is the summary; `*-doctor-*.log` are the full Doctor logs; `*-config-{before,after}.json`; `*-tree-*.txt` are sha256 listings.
- `updater/subdir/`: published `openclaw@2026.10.1` (npm, scratch prefix) runs the profile (three turns, stored sessions), then its own `openclaw update --tag <candidate.tgz> --yes --no-restart`; the candidate Gateway then runs on the same state (sessions and chat history listed before its turns).
- `updater/cli/`: same with `claude-cli` as the model backend and a synthetic `claude` (`drivers/claude`): the candidate Doctor warns instead of pinning, the candidate Gateway resumes the CLI conversation 2026.10.1 stored, then the key from the warning is applied by hand and the next turn starts a fresh CLI session (`reason=cwd`).
- `updater/prepinned/`: the subdir profile with `agents.entries.main.workspace` already authored, so the repair writes nothing; used to check whether the updater's `Automatic database restoration unavailable` warning depends on the repair (it does not: it appears here too).
- `updater/subdir-run1/`: an earlier run of the subdir shape on the same candidate (same warning, same result).
- `templates/`: `template-probe.txt` (whether a root seeded by 2026.10.1 counts as customized, on this branch and on base), `template-hashes-by-release.txt` (the stock SOUL/IDENTITY/USER/AGENTS template bytes of every release tag from v2026.5.12 to v2026.10.2, and whether this branch recognizes them), and the two scripts.
- `tests/`: targeted tests green, the red run (new tests against the previous repair module), the owning lane, the base run of the one failing lane file, static checks with `check:changed`, build and package logs.
- `drivers/`: the scripts that produced the above.
