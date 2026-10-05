# 164796 real Claude recovery proof

Run 2026-10-05 (PDT) for openclaw/openclaw#164796. Nothing pushed. No production Gateway, config, state or restart. Real login used in place by the real `claude` binary; no token, email, account uuid or org id is stored (the owner shows only as `h:<8 hex>` of the stored fingerprint).

- AFTER: `69861729ddf1e3b8e66ad6677ab61784a37437ac` (`OpenClaw 2026.9.8 (6986172)`). BEFORE: PR merge-base `0816aa1b57dc815d0c1e0d48bcb9517980985438`. Both built on the studio (`pnpm build`), pruned with `pnpm install --prod --offline`, tarball sha256 after `787320d3af940990fc2b26bed283fd3bfdadf4e9312cbd17d095fecce09f54cd`, before `6e636510ad30136a8a150734bd434cade55654d37c32e32fe3012de6b07f6295`, copied to the host that ran them.
- Method: `harness/run-arm.sh` (`openclaw agent --local`, isolated `OPENCLAW_STATE_DIR` and `OPENCLAW_CONFIG_PATH`, `env -i`, port 18991 never bound, model `claude-cli/claude-haiku-4-5`). Turn 1 plants a canary; the run's own Claude project dir is deleted (replacement session, same OpenClaw session id); turn 2 asks for the canary with tools forbidden. `harness/boundary.mjs` prints the stored `cliHistoryBoundary` with owner fields as hash labels.

## Results
- `real/macbook-login/after-recover.txt`: boundary `known` after turn 1 (`h:d188d040`), turn 2 `historyPrompt=present`, reply is the canary.
- `real/macbook-login/before-recover.txt`: `refused across auth boundary: reason=auth-unknown`, `historyPrompt=none`, reply `UNKNOWN`, boundary never stored.
- `real/macbook-login/after-switch.txt`: turn 2 under a synthetic `CLAUDE_CONFIG_DIR` login: refusal, `historyPrompt=none`, boundary `unknown`, then the real claude CLI fails `Not logged in` (fake token), `exit=1`. The log reason does not distinguish owner-differs from unattestable.
- `real/mini-setup-token/`: the same AFTER recovery arm on the Mac mini login, which is a long-lived setup token (scope `user:inference`). The real profile endpoint answers it HTTP 403 (`profile-probe.txt`), so the branch refused history in both turns, reply `UNKNOWN`. This is a contradicting run: on that login the branch gives no recovery. Kept, not hidden.

## Not covered
Second real account; repeated runs (one per arm); setup-token logins (no recovery by design of the scope check); queued-coverage window with the real binary; the Keychain-held login was the MacBook's (file-backed on the mini).

## Hosts and cleanup
Builds: studio `openclaw` user. MacBook (`etzelm`, Keychain login, claude 2.1.283): the three MacBook arms. Mini (file-backed setup-token login, claude 2.1.289): `mini-setup-token`. Deleted afterwards: studio `~/work/164796-e` and `/private/tmp/164796-e`, MacBook `~/oc164796e` and its Claude project dirs, mini `/Users/openclaw/oc164796e` and its Claude project dirs, NAS `scratch/2026-10-05/164796-e`, temp refs `tmp/164796-e*` in the NAS repo. The synthetic config dir created no Keychain item (`security find-generic-password` exit 44). Production gateway still listening on 18789.
Raw per-turn JSON (system prompt report) was not kept: it is 23 KB per turn and holds workspace paths; the replies, log lines and boundaries above are the evidence. A secret scan (token prefixes and bearer headers) over this folder returns nothing.
