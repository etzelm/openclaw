# 164796 evidence at head 5f246eff (base 012bb1ccaf0)

Signed head `5f246eff` (tree `81f50f8c4f2d`), base `012bb1ccaf0b63696b2608599b1cf4ea869a4245`. All captures ran on one Mac Studio at commit `dfd14597b12`, which has the identical tree `81f50f8c4f2df2fbe57a2302f88c9b04b21a7123` (`gates/identity.txt`). The signed chain `5fa23ce27fc` (merge of `5fd7205504d` and `012bb1ccaf0`) plus `5f246eff` has the same tree, so the same tests and builds apply. `runs/base-*` ran a build of `012bb1ccaf0` itself.

- `SUMMARY.md`: index of what was ported, gates, mutations and harness results, with the exact log names. Its commit SHAs are the unsigned Studio chain; the tree is the same.
- `gates/`: typecheck (`f-tsgo-*.log`), targeted vitest (`f-targeted.log`), owning-directory lanes (`f-lane-*.log`, `lane-*.log`), `check:changed` (`f-check-changed.log`), builds, and the main-alone control for the config sessions lane (`main-lane-config-sessions.log`).
- `mutations/`: `redgreen.sh` and `redgreen.log` (RED1 to RED5, each mutated then restored).
- `harness/`: harness logs and the fixed `queued-switch-shim.fixed.mjs` (main now transfers the worker command buffer, so the shim decodes before `postMessage`). The other harness scripts are unchanged from `../head-5fd72055/harness/`.
- `runs/after-<scenario>/`, `runs/base-<scenario>/`, `outcomes-after.txt`, `outcomes-base.txt`: per-scenario records in the same format as `../head-5fd72055/`. The `upgrade` scenario was not run at this head.

Paths are redacted to `$RUN`, `$TREE`, `$BASE`, `$LOGS` and `$HOME`. Gateway bearer tokens of the throwaway harness gateways are redacted. Tokens in the harness are synthetic (`synthetic-<account>`). Synthetic login files, SQLite files and the synthetic home are not included.
