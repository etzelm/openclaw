# Proof: saved Anthropic subscription token gives claude-cli a durable-recovery owner

Upstream main SHA: `5aec205816506ceb6983a5ab1c549c9e0b301a61` (openclaw/openclaw main, committed 2026-10-16 08:42 -0700, OpenClaw 2026.10.4). Built with `pnpm install --frozen-lockfile && pnpm build` on the Mac Studio node. No production code touched, nothing pushed.

Seam: real built `openclaw.mjs agent --local`, real SQLite session store, real auth-profile store, real claude-cli backend and stream-json transport. Only the `claude` executable is the synthetic child from the 164796 evidence harness (`harness/bin/claude`, resolved first on PATH). Every token is synthetic. Each arm has its own HOME, OPENCLAW_STATE_DIR, OPENCLAW_CONFIG_PATH and CLAUDE_CONFIG_DIR under the run dir. Paths are redacted to $RUN/$TREE/$HOME. No call to api.anthropic.com showed up in any stderr.

## Commands

Save the profile (the documented route, `docs/gateway/cli-backends.md` "Normal agent turns can also use a saved subscription token without a native login"):

    printf '%s\n' "$TOKEN" | node openclaw.mjs models auth paste-token --provider anthropic

- `paste-token` reads the token from stdin when piped (no TTY needed). It has no `--token` flag; its options are `--agent --expires-in --profile-id --provider`.
- Deviation from the brief: the token cannot literally be `synthetic-token-A`. `validateAnthropicSetupToken` (src/plugins/provider-auth-token.ts) requires prefix `sk-ant-oat01-` and length >= 80. I used `sk-ant-oat01-synthetic-token-A-` plus 60 `x` (91 chars). Still synthetic.
- Result: `Auth profile: anthropic:manual (anthropic/token)`; `auth.profiles["anthropic:manual"] = {provider: anthropic, mode: token}` is added to openclaw.json. No `--set-default`, no account order, no `@profile` model suffix, no config edit by me.
- Every turn: `node openclaw.mjs agent --local --agent main --session-id <id> --message "<text>" --model claude-cli/claude-sonnet-5 --json`.

## Arms

Prompts: T1 "Remember: the vault codeword is PINEAPPLE-7. Reply STORED." T2 "What is the codeword?" "User msg" is the length of the user message the synthetic child received (`fake-claude.log.user-<pid>-1.txt`). Each turn is a fresh Claude session because the synthetic child writes no transcript.

| Arm | Auth | Turn | Session | Exit | User msg chars | Canary in msg | Refusal line | Boundary after turn |
|---|---|---|---|---|---|---|---|---|
| A control | native login only | 1 | s1 | 0 | 85 | PINEAPPLE-7 (current prompt) | `history refused ... reason=auth-unknown` | none |
| A | native login only | 2 | s1 | 0 | 436 | PINEAPPLE-7 absent | `history refused ... reason=auth-unknown` | none |
| B documented | saved token only (no native login on disk) | 1 | s1 | 0 | 85 | PINEAPPLE-7 (current prompt) | none | known, maxSeq 2 |
| B | saved token only | 2 | s1 | 0 | 516 | PINEAPPLE-7 present | none | known, maxSeq 4 |
| Bn extra | native login + saved token | 1 | s1 | 0 | 85 | PINEAPPLE-7 | none | known, maxSeq 2 |
| Bn | native login + saved token | 2 | s1 | 0 | 516 | PINEAPPLE-7 present | none | known, maxSeq 4 |
| C late profile | native login | 1 | s1 | 0 | 85 | PINEAPPLE-7 | `history refused ... auth-unknown` | none |
| C | token saved after turn 1 | 2 | s1 | 0 | 436 | PINEAPPLE-7 absent | `history refused ... auth-unknown` | none |
| C | token | 3 | proof-session-2 | 0 | 79 | MANGO-5 (current prompt) | none | known, maxSeq 2 (new session) |
| C | token | 4 | proof-session-2 | 0 | 510 | MANGO-5 present, recovered | none | known, maxSeq 4 (new session) |

Note: the brief expected A turn 2 at 449 chars; on this SHA the no-history message is 436 chars. Same shape (no codeword, refusal logged). Boundary lines in C show two rows once the second session exists; the first row (s1) stays `none`.

Arm D was not needed: in B the saved profile was selected automatically by a new session with no extra selection.

## How the token reached the child

The synthetic child (patched in my scratch copy only to log env var NAMES, never values) recorded:

- Arm A: env names `["CLAUDE_CONFIG_DIR"]`, no fd variable.
- Arm B turns 1 and 2: env names `["CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR","CLAUDE_CONFIG_DIR"]`, `CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR=3`, and reading fd 3 yields 91 bytes, exactly the saved token length (value not printed). So the profile is forwarded through the protected file descriptor.
- Arm C turn 2 (same session, profile saved afterwards): no fd variable, i.e. the existing session kept its native account, matching the docs ("Existing sessions keep their account"). Turns 3 and 4 (new session): fd variable present.

## Verbatim key log lines

Arm A turn 2 and arm C turn 2 (stderr):

    [agent/cli-backend] cli session history refused across auth boundary: reason=auth-unknown

Arm B turn 2 (stderr; the only reset lines, no refusal line):

    [agents/agent-command] cli session reset: provider=claude-cli reason=transcript-missing sessionKey=agent:main:explicit:s1
    [agent/cli-backend] cli session reset: provider=claude-cli reason=missing-transcript

(The reset lines are the synthetic child not writing a native transcript, so the binding is cleared and a fresh Claude session starts. They appear in A as well; they are not the discriminator. The discriminator is the missing refusal line plus 516 vs 436 chars.)

`openclaw models auth list` (B, C): `- anthropic:manual [anthropic/token]`. `openclaw models status` (B): `anthropic effective=profiles:... | profiles=1 (0 oauth, 1 token, 0 api-key) | anthropic:manual=token:sk-ant-o...xxxxxxxx`. Arm A: `Profiles: (none)`.

## Docs now versus observed

Docs (`docs/gateway/cli-backends.md` and `docs/providers/anthropic.md`) already say: saved subscription tokens are selected for new sessions by account order and forwarded through a protected file descriptor; existing sessions keep their account; "Fresh CLI sessions can recover OpenClaw history from the session SQLite database when its independent account boundary matches the selected credential." They do not say that a native `claude auth login` alone gives no such boundary, so recovery is refused with `reason=auth-unknown`, nor that the saved-token route is what supplies one. Observed: native login only => history withheld and no boundary stored; saved token profile => history delivered and boundary `known`; profile saved mid-conversation => the old session is still refused (history written before the profile has no recorded boundary) while a new session recovers fully.

## Surprising or worth knowing

- `paste-token` validates `sk-ant-oat01-` prefix and 80-char minimum, so docs examples using arbitrary tokens would fail.
- `paste-token` and `models auth list` print "Model auth changes were saved, but the local Gateway could not refresh them" in this isolated state; harmless here.
- Auth store location differs: with no profile, `models status` points at `state/agents/main/agent/openclaw-agent.sqlite`; with a profile it points at `state/state/openclaw.sqlite`.
- No `--set-default`, account order or `@profile` was necessary for claude-cli to pick the sole saved profile (this config has a single profile; behavior with several profiles or an explicit empty account order was not tested, docs say those stay authoritative).
- Not covered: real Claude behavior, token expiry/refresh, multi-profile ordering.

## Files

Per arm directory (A, B, Bn, C): turns.log, turn*.err, fake-claude.log (includes child-env records), fake-claude.log.user-*.txt, boundary-by-turn.txt, models-status.txt, save-profile.txt, openclaw.json. Redacted, no token values (grepped).
