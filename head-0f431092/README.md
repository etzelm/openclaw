# Evidence for the merged head (tree 40b1adb06cea98e037337d3f2967f9a3320ecdf3)

Every log here ran at commit 79a4c3bb3bc (tree 40b1adb06cea, `gates/identity.txt`), the merge of origin/main ee2c67141c1 into the simplified branch, except the `main-check-*` logs, `base-*` files and `mutations/red-on-base/` (clean ee2c67141c1) and `release-install.log` (the openclaw@2026.10.4 install the upgrade scenario starts from). Paths are redacted to `$RUN`, `$TREE`, `$BASE` and `$HOME`.

- `gates/summary.txt`: EXIT codes of every step, HEAD and tree printed before and after.
- `mutations/redgreen.log`: RED1 to RED10. `mutations/red-on-base/`: the branch's test files on clean ee2c67141c1.
- `harness/`: 36 scenarios plus the upgrade arm on the built dist; `compare.txt` against the previous head's captures; `scripts/` is the harness as run (the synthetic child writes its transcript under CLAUDE_CONFIG_DIR, and interrupted-fresh removes that directory too).
- `runs/`: whole records for the scenarios the PR body links.
