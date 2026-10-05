# PR 165112 round 2 evidence (staged, not pushed)

Code under test: `fix/converged-roster-workspace-pin` at `06cd0cffa1b` plus the round 2 commit (local SHA d11aee70ef6f, patch in ../patches).
Traces were built and captured at local commit 06db3c06ae8. d11aee70ef6f differs from it only by one sentence in docs/gateway/doctor/config-migrations.md and the commit message.
Pre-fix comparison builds `06cd0cffa1b` (the current PR head).
All profiles are fresh temp HOME / OPENCLAW_HOME directories with synthetic keys and a scripted mock provider. Paths are redacted to `<profile>`, `<work>` and `~`.

- cases/         eight real `openclaw doctor` / `doctor --fix --non-interactive` runs plus Gateway turns (root, subdir, neither, both, agentsmd, env, tilde, include). `<case>.out` is the summary; `*-doctor-*.log` are the full Doctor logs; `*-config-{before,after}.json`; `*-tree-*.txt` are sha256 listings.
- pre-fix-include/   the include case on a build of 06cd0cffa1b (the defect, real run).
- cli-backend/   claude-cli backend with a synthetic `claude` stub: session reset on working-directory change.
- updater/       published openclaw 2026.9.8 `openclaw update --tag <candidate.tgz>` for the subdir and include shapes.
- tests/         red (include test against 06cd0cffa1b source), green (27 tests), owning lane (90 files, 1089 tests).
- sandbox/       container route feasibility on the studio.
- drivers/, cli-backend/*.sh|*.mjs|claude, updater/*.sh   the scripts that produced the above.

- sandbox-real/   real sandbox-enabled turns on Docker 29.8.1 (Gateway docker backend, real read/write/exec tools, no shim): 18 turns (3 layouts x before/after Doctor x none/ro/rw) at 06cd0cffa1b. `sandbox-real.md` is the summary and result table, `report-summary.md` the per-case mounts and host checks, `report-detail.md` every probe, `raw/<case>/` the provider requests, gateway logs and `docker inspect` mounts, `scripts/` the drivers. The Studio account name is replaced by `<studio-user>`.
- sandbox/container-route-feasibility.txt   why the studio node's own account cannot reach Docker; the sandbox-real run used the sanctioned operator route instead.
