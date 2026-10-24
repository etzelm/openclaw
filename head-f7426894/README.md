# openclaw/openclaw#178929 evidence at head f7426894653 (tree 244095c462f8)

Base d48dfd6c974. Built CLI (`node <tree>/openclaw.mjs agent --local`) on both arms, macOS, Node 24.22.1.
BEFORE = this tree with only `src/plugin-sdk/provider-auth-claude-compat.ts` restored to base; AFTER = the head exactly.

- `outcomes-before.txt`, `outcomes-after.txt`: one line per scenario (header explains the columns).
- `identity.txt`: shas, build exits and timings, isolation and Keychain notes.
- `scripts/`: the harness as run. `bin/claude` is the synthetic Claude child; `profile-stub.mjs` is a local stub of the
  OAuth profile endpoint; `shim/managed-settings-shim.mjs` redirects only reads under
  `/Library/Application Support/ClaudeCode` to a per-run fixture (the real root-owned directory is never created or written).
- `runs/<arm>-<scenario>/`: per-run records: child log, delivered user messages (`.user-*`), hook context (`.context-*`),
  `turn*.err.tail` (refusal lines), `boundary-by-turn.txt`, `managed-redirect.log`.
- `mutations.log`: the unit-test mutation matrix (RED0 to RED7).

Synthetic tokens and accounts only; home paths are redacted to `~`, run paths to `$RUN`.
