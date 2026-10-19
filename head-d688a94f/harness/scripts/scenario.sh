#!/bin/bash
# usage: scenario.sh <tree-dir> <label> <scenario>
# Real built openclaw (`agent --local`), real SQLite session, real native-login files on disk,
# real Anthropic Claude runtime and stream-json transport. Only the claude executable is a
# synthetic child (harness/bin/claude) that records what reaches its stdin.
set -u
export PATH=$HOME/homebrew/bin:$PATH
TREE=$1; LABEL=$2; SCEN=$3
H=${HARNESS_DIR:-$HOME/work/pr-164796-h/harness}
RUN=$H/runs/$LABEL-$SCEN
rm -rf "$RUN"; mkdir -p "$RUN/home" "$RUN/state"
LOGIN=$RUN/claude-config
export HOME=$RUN/home
export OPENCLAW_STATE_DIR=$RUN/state
export OPENCLAW_CONFIG_PATH=$RUN/openclaw.json
# The operator's opt-in to native login attestation (optin.mjs). HARNESS_ATTEST=0 leaves it unset.
optin() { node "$H/optin.mjs" "$OPENCLAW_CONFIG_PATH" "$([ "${HARNESS_ATTEST:-1}" = 1 ] && echo on || echo off)"; }
export CLAUDE_CONFIG_DIR=$LOGIN
export PATH=$H/bin:$PATH
export FAKE_CLAUDE_LOG=$RUN/fake-claude.log
export USER=harness-user
# STUB of Anthropic's OAuth profile endpoint (profile-stub.mjs). The fetch shim sends only the
# profile request there; synthetic tokens "synthetic-<account>" attest to "<account>".
echo ok > "$RUN/profile-mode"
node "$H/profile-stub.mjs" "$RUN/profile-mode" "$FAKE_CLAUDE_LOG" "$RUN/profile-port" &
STUB=$!
trap 'kill $STUB 2>/dev/null' EXIT
for _ in $(seq 50); do [ -s "$RUN/profile-port" ] && break; sleep 0.1; done
export FAKE_PROFILE_PORT=$(cat "$RUN/profile-port")
export NODE_OPTIONS="--import $H/shim/profile-fetch-shim.mjs ${EXTRA_NODE_OPTIONS:-}"
mkdir -p "$RUN/workspace/skills/harness-skill"
printf -- '---\nname: harness-skill\ndescription: Harness skill whose config injects an environment variable.\n---\nNo instructions.\n' > "$RUN/workspace/skills/harness-skill/SKILL.md"
SKILL_LOGIN=$RUN/skill-claude-config
write_config() { # optional skill CLAUDE_CONFIG_DIR value
  if [ -n "${1:-}" ]; then
    printf '{"agents":{"defaults":{"workspace":"%s"}},"skills":{"entries":{"harness-skill":{"env":{"CLAUDE_CONFIG_DIR":"%s"}}}}}' "$RUN/workspace" "$1" > "$OPENCLAW_CONFIG_PATH"; optin
  else
    printf '{"agents":{"defaults":{"workspace":"%s"}}}' "$RUN/workspace" > "$OPENCLAW_CONFIG_PATH"; optin
  fi
}
write_config
# The probe-note plugin (plugins/probe-note) appends one saved note at agent_end of a chosen turn.
write_probe_config() {
  printf '{"agents":{"defaults":{"workspace":"%s"}},"plugins":{"load":{"paths":["%s"]},"entries":{"probe-note":{"enabled":true,"hooks":{"allowConversationAccess":true}}}}}' "$RUN/workspace" "$H/plugins/probe-note" > "$OPENCLAW_CONFIG_PATH"; optin
}
write_account() { # dir uuid
  mkdir -p "$1"
  printf '{"oauthAccount":{"accountUuid":"%s","emailAddress":"%s@example.invalid"}}' "$2" "$2" > "$1/.claude.json"
  printf '{"claudeAiOauth":{"accessToken":"synthetic-%s","expiresAt":1893456000000}}' "$2" > "$1/.credentials.json"
}
login() { write_account "$LOGIN" "$1"; }
SWITCH_TO_B="printf '{\"oauthAccount\":{\"accountUuid\":\"account-B\",\"emailAddress\":\"account-B@example.invalid\"}}' > '$LOGIN/.claude.json'; printf '{\"claudeAiOauth\":{\"accessToken\":\"synthetic-account-B\",\"expiresAt\":1893456000000}}' > '$LOGIN/.credentials.json'"
SWITCH_TO_A="printf '{\"oauthAccount\":{\"accountUuid\":\"account-A\",\"emailAddress\":\"account-A@example.invalid\"}}' > '$LOGIN/.claude.json'; printf '{\"claudeAiOauth\":{\"accessToken\":\"synthetic-account-A\",\"expiresAt\":1893456000000}}' > '$LOGIN/.credentials.json'"
REVOKE="rm -f '$LOGIN/.credentials.json'"
turn() { # n message
  echo "--- turn $1: $2" >> "$RUN/turns.log"
  echo "turn $1 tree=$TREE session=${SESSION_ID:-harness-session}" >> "$RUN/turns.log"
  ( cd "$RUN" && node "$TREE/openclaw.mjs" agent --local --agent main --session-id "${SESSION_ID:-harness-session}" \
      --message "$2" --model claude-cli/claude-sonnet-5 --json > "$RUN/turn$1.out" 2> "$RUN/turn$1.err" )
  echo "turn $1 exit=$?" >> "$RUN/turns.log"
  DBF=$(find "$RUN/state/agents" -name openclaw-agent.sqlite 2>/dev/null | head -1)
  [ -n "$DBF" ] && echo "after turn $1: $(node "$H/boundary.mjs" "$DBF" 2>&1)" >> "$RUN/boundary-by-turn.txt"
}
mark() { echo "=== $1" >> "$RUN/fake-claude.log"; }

login account-A
case "$SCEN" in
  allowed)
    mark "turn1 (account A)"; turn 1 "Remember: the vault codeword is PINEAPPLE-7. Reply STORED."
    mark "turn2 (account A, fresh claude session)"; turn 2 "What is the codeword?" ;;
  optout-allowed)
    # The operator never opted in: no profile request, and no saved history, as before this change.
    node "$H/optin.mjs" "$OPENCLAW_CONFIG_PATH" off
    mark "turn1 (account A, attestNativeLogin not set)"; turn 1 "Remember: the vault codeword is PINEAPPLE-7. Reply STORED."
    mark "turn2 (account A, attestNativeLogin not set, fresh claude session)"; turn 2 "What is the codeword?" ;;
  optin-withdrawn)
    mark "turn1 (account A, attestNativeLogin true)"; turn 1 "Remember: the vault codeword is PINEAPPLE-7. Reply STORED."
    node "$H/optin.mjs" "$OPENCLAW_CONFIG_PATH" off
    mark "turn2 (account A, attestNativeLogin removed, fresh claude session)"; turn 2 "What is the codeword?" ;;
  optin-later)
    # Rows written before the opt-in have no recorded owner and stay out of recovery.
    node "$H/optin.mjs" "$OPENCLAW_CONFIG_PATH" off
    mark "turn1 (account A, attestNativeLogin not set)"; turn 1 "Remember: the vault codeword is PINEAPPLE-7. Reply STORED."
    node "$H/optin.mjs" "$OPENCLAW_CONFIG_PATH" on
    mark "turn2 (account A, attestNativeLogin true, fresh claude session)"; turn 2 "What is the codeword?"
    mark "turn3 (account A, attestNativeLogin true, new conversation)"; SESSION_ID=harness-session-2 turn 3 "Remember: the new codeword is MANGO-5. Reply STORED."
    mark "turn4 (account A, attestNativeLogin true, new conversation, fresh claude session)"; SESSION_ID=harness-session-2 turn 4 "What is the codeword?" ;;
  different-account)
    mark "turn1 (account A)"; turn 1 "Remember: the vault codeword is PINEAPPLE-7. Reply STORED."
    eval "$SWITCH_TO_B"
    mark "turn2 (account B)"; turn 2 "What is the codeword?" ;;
  revoked)
    mark "turn1 (account A)"; turn 1 "Remember: the vault codeword is PINEAPPLE-7. Reply STORED."
    eval "$REVOKE"
    mark "turn2 (credential revoked)"; turn 2 "What is the codeword?" ;;
  reassign-before-send)
    mark "turn1 (account A)"; turn 1 "Remember: the vault codeword is PINEAPPLE-7. Reply STORED."
    mark "turn2 (account A at launch; login reassigned to B while claude initializes, before the prompt is sent)"
    FAKE_ON_INIT="$SWITCH_TO_B" turn 2 "What is the codeword?" ;;
  revoke-before-send)
    mark "turn1 (account A)"; turn 1 "Remember: the vault codeword is PINEAPPLE-7. Reply STORED."
    mark "turn2 (account A at launch; credential revoked while claude initializes, before the prompt is sent)"
    FAKE_ON_INIT="$REVOKE" turn 2 "What is the codeword?" ;;
  empty-first-turn-switch)
    mark "turn1 (prepared under A; login reassigned to B before the prompt is sent; first turn, no recovery prompt)"
    FAKE_ON_INIT="$SWITCH_TO_B" turn 1 "Remember: the vault codeword is BANANA-3. Reply STORED."
    eval "$SWITCH_TO_A"
    mark "turn2 (back on account A)"; turn 2 "What is the codeword?" ;;
  coverage-switch)
    mark "turn1 (account A)"; turn 1 "Remember: the vault codeword is PINEAPPLE-7. Reply STORED."
    mark "turn2 (account A at launch and at send; login reassigned to B after the prompt was delivered, before the turn is committed)"
    FAKE_ON_USER="$SWITCH_TO_B" turn 2 "Remember: the second codeword is BANANA-3. Reply STORED."
    eval "$SWITCH_TO_A"
    mark "turn3 (back on account A)"; turn 3 "What are the codewords?" ;;
  queued-reassign)
    # The final turn commit (rows plus coverage) is posted to the SQLite worker while the login is
    # still account A. queued-switch-shim.mjs reassigns the login to B right after that post,
    # before the worker opens its transaction (harness/shim/queued-switch-shim.mjs).
    mark "turn1 (account A)"; turn 1 "Remember: the vault codeword is PINEAPPLE-7. Reply STORED."
    mark "turn2 (account A at launch, at send and when the commit is posted; login reassigned to B while that commit is queued)"
    QUEUED_SWITCH_COMMAND=session.turn.commit QUEUED_SWITCH_NTH=2 QUEUED_SWITCH_SCRIPT="$SWITCH_TO_B" \
      QUEUED_SWITCH_LOG="$RUN/queued.log" NODE_OPTIONS="$NODE_OPTIONS --import $H/shim/queued-switch-shim.mjs" \
      turn 2 "Remember: the second codeword is BANANA-3. Reply STORED."
    eval "$SWITCH_TO_A"
    mark "turn3 (back on account A)"; turn 3 "What are the codewords?" ;;
  skill-config-dir)
    # The Gateway login is the default ~/.claude one; a skill's env config injects
    # CLAUDE_CONFIG_DIR at execution time, so the child runs under another login.
    unset CLAUDE_CONFIG_DIR
    mkdir -p "$HOME/.claude"
    printf '{"oauthAccount":{"accountUuid":"account-GATEWAY","emailAddress":"g@example.invalid"}}' > "$HOME/.claude.json"
    printf '{"claudeAiOauth":{"accessToken":"synthetic-gateway","expiresAt":1893456000000}}' > "$HOME/.claude/.credentials.json"
    write_account "$SKILL_LOGIN" account-SKILL
    write_config "$SKILL_LOGIN"
    mark "turn1 (skill config injects CLAUDE_CONFIG_DIR=skill login at execution)"
    turn 1 "Remember: the vault codeword is PINEAPPLE-7. Reply STORED."
    write_config
    mark "turn2 (no skill env: child runs under the Gateway login)"
    turn 2 "What is the codeword?" ;;
  skill-config-dir-persistent)
    # The same skill env stays configured on every turn, so every child runs under the skill login.
    unset CLAUDE_CONFIG_DIR
    mkdir -p "$HOME/.claude"
    printf '{"oauthAccount":{"accountUuid":"account-GATEWAY","emailAddress":"g@example.invalid"}}' > "$HOME/.claude.json"
    printf '{"claudeAiOauth":{"accessToken":"synthetic-gateway","expiresAt":1893456000000}}' > "$HOME/.claude/.credentials.json"
    write_account "$SKILL_LOGIN" account-SKILL
    write_config "$SKILL_LOGIN"
    mark "turn1 (skill config injects CLAUDE_CONFIG_DIR=skill login at execution)"
    turn 1 "Remember: the vault codeword is PINEAPPLE-7. Reply STORED."
    mark "turn2 (same skill config still injects the skill login)"
    turn 2 "What is the codeword?" ;;
  keychain-allowed|keychain-ambiguous-prep|keychain-fails-before-send|keychain-fails-at-commit)
    # The Keychain is shimmed at the child_process seam (harness/shim/security-shim.mjs). A stale
    # account-A .credentials.json always sits on disk beside it.
    export NODE_OPTIONS="$NODE_OPTIONS --import $H/shim/security-shim.mjs"
    export FAKE_SECURITY_MODE_FILE=$RUN/security-mode
    export FAKE_SECURITY_LOG=$FAKE_CLAUDE_LOG
    MODE_PRESENT="echo present > '$RUN/security-mode'"
    MODE_FAIL="echo fail > '$RUN/security-mode'"
    case "$SCEN" in
      keychain-allowed)
        echo present > "$RUN/security-mode"
        mark "turn1 (Keychain item readable, account A)"; turn 1 "Remember: the vault codeword is PINEAPPLE-7. Reply STORED."
        mark "turn2 (Keychain item readable, fresh claude session)"; turn 2 "What is the codeword?" ;;
      keychain-ambiguous-prep)
        echo fail > "$RUN/security-mode"
        mark "turn1 (both Keychain lookups time out, stale account-A credentials file on disk)"; turn 1 "Remember: the vault codeword is PINEAPPLE-7. Reply STORED."
        mark "turn2 (both Keychain lookups time out, stale file still on disk)"; turn 2 "What is the codeword?" ;;
      keychain-fails-before-send)
        echo present > "$RUN/security-mode"
        mark "turn1 (Keychain item readable)"; turn 1 "Remember: the vault codeword is PINEAPPLE-7. Reply STORED."
        mark "turn2 (Keychain readable at preparation; both lookups start timing out while claude initializes, before the prompt is sent)"
        FAKE_ON_INIT="$MODE_FAIL" turn 2 "What is the codeword?" ;;
      keychain-fails-at-commit)
        echo present > "$RUN/security-mode"
        mark "turn1 (Keychain item readable)"; turn 1 "Remember: the vault codeword is PINEAPPLE-7. Reply STORED."
        mark "turn2 (Keychain readable at preparation and at send; both lookups start timing out after the prompt was delivered, before the turn is committed)"
        FAKE_ON_USER="$MODE_FAIL" turn 2 "Remember: the second codeword is BANANA-3. Reply STORED."
        echo present > "$RUN/security-mode"
        mark "turn3 (Keychain readable again)"; turn 3 "What are the codewords?" ;;
    esac ;;
  record-credential-mismatch)
    mark "turn1 (account A: record A, credential A)"; turn 1 "Remember: the vault codeword is PINEAPPLE-7. Reply STORED."
    printf '{"claudeAiOauth":{"accessToken":"synthetic-account-B","expiresAt":1893456000000}}' > "$LOGIN/.credentials.json"
    mark "turn2 (a credential for account B beside the unchanged account-A record)"; turn 2 "What is the codeword?" ;;
  record-relabel)
    mark "turn1 (account A)"; turn 1 "Remember: the vault codeword is PINEAPPLE-7. Reply STORED."
    printf '{"oauthAccount":{"accountUuid":"account-B","emailAddress":"account-B@example.invalid"}}' > "$LOGIN/.claude.json"
    mark "turn2 (account A's credential beside a record relabelled to account B)"; turn 2 "What is the codeword?" ;;
  profile-timeout)
    mark "turn1 (account A)"; turn 1 "Remember: the vault codeword is PINEAPPLE-7. Reply STORED."
    echo timeout > "$RUN/profile-mode"
    mark "turn2 (account A; the profile endpoint holds every request open)"; turn 2 "What is the codeword?" ;;
  profile-401)
    mark "turn1 (account A)"; turn 1 "Remember: the vault codeword is PINEAPPLE-7. Reply STORED."
    echo 401 > "$RUN/profile-mode"
    mark "turn2 (account A; the profile endpoint rejects the token with 401)"; turn 2 "What is the codeword?" ;;
  expired-unattested)
    mark "turn1 (account A)"; turn 1 "Remember: the vault codeword is PINEAPPLE-7. Reply STORED."
    printf '{"claudeAiOauth":{"accessToken":"synthetic-account-A~1","expiresAt":1000}}' > "$LOGIN/.credentials.json"
    mark "turn2 (account A's token was rotated elsewhere and has already expired; this process never attested it)"; turn 2 "What is the codeword?" ;;
  refresh-due)
    mark "turn1 (account A)"; turn 1 "Remember: the vault codeword is PINEAPPLE-7. Reply STORED."
    printf '{"claudeAiOauth":{"accessToken":"synthetic-account-A~2","expiresAt":%s}}' "$(( $(date +%s) * 1000 + 120000 ))" > "$LOGIN/.credentials.json"
    mark "turn2 (account A's token expires in 2 minutes; the child rotates it to a new account-A token at initialize, as Claude CLI does before answering initialize)"
    FAKE_ON_INIT="printf '{\"claudeAiOauth\":{\"accessToken\":\"synthetic-account-A~3\",\"expiresAt\":1893456000000}}' > '$LOGIN/.credentials.json'" \
      turn 2 "Remember: the second codeword is BANANA-3. Reply STORED."
    mark "turn3 (account A, the rotated token, fresh claude session)"; turn 3 "What are the codewords?" ;;
  rotate-after-send)
    mark "turn1 (account A)"; turn 1 "Remember: the vault codeword is PINEAPPLE-7. Reply STORED."
    mark "turn2 (account A's token is valid for hours; the child rotates it to a new account-A token after the prompt arrives)"
    FAKE_ON_USER="printf '{\"claudeAiOauth\":{\"accessToken\":\"synthetic-account-A~4\",\"expiresAt\":1893456000000}}' > '$LOGIN/.credentials.json'" \
      turn 2 "Remember: the second codeword is BANANA-3. Reply STORED."
    mark "turn3 (account A, the rotated token, fresh claude session)"; turn 3 "What are the codewords?" ;;
  upgrade)
    # UPGRADE_FROM is the released install (v2026.10.1); TREE is the candidate build. Same state
    # dir and login throughout. The released schema has no attestNativeLogin key, so the operator
    # opts in only after the upgrade.
    node "$H/optin.mjs" "$OPENCLAW_CONFIG_PATH" off
    mark "turn1 (released ${UPGRADE_LABEL:-old}, account A)"; TREE=$UPGRADE_FROM turn 1 "Remember: the vault codeword is PINEAPPLE-7. Reply STORED."
    mark "turn2 (released ${UPGRADE_LABEL:-old}, account A, fresh claude session)"; TREE=$UPGRADE_FROM turn 2 "What is the codeword?"
    cp "$OPENCLAW_CONFIG_PATH" "$RUN/config-before-upgrade.json"
    node "$H/transcript.mjs" "$(find "$RUN/state/agents" -name openclaw-agent.sqlite | head -1)" > "$RUN/transcript-before-upgrade.txt" 2>&1
    # The candidate refuses an agent database at the released schema until doctor migrates it.
    ( cd "$RUN" && node "$TREE/openclaw.mjs" doctor --fix --non-interactive > "$RUN/doctor.out" 2>&1; echo "doctor exit=$?" >> "$RUN/turns.log" )
    node "$H/transcript.mjs" "$(find "$RUN/state/agents" -name openclaw-agent.sqlite | head -1)" > "$RUN/transcript-after-doctor.txt" 2>&1
    node "$H/optin.mjs" "$OPENCLAW_CONFIG_PATH" on
    mark "turn3 (candidate, same conversation, fresh claude session)"; turn 3 "What is the codeword?"
    cp "$OPENCLAW_CONFIG_PATH" "$RUN/config-after-upgrade.json"
    mark "turn4 (candidate, new conversation, account A)"; SESSION_ID=harness-session-2 turn 4 "Remember: the new codeword is MANGO-5. Reply STORED."
    mark "turn5 (candidate, new conversation, fresh claude session)"; SESSION_ID=harness-session-2 turn 5 "What is the codeword?" ;;
  note-resumed-allowed)
    # Turn 1 leaves a saved note (KIWI-9) through the plugin SDK; turns 2 and 3 resume the Claude session.
    export FAKE_WRITE_TRANSCRIPT=1; write_probe_config
    mark "turn1 (account A, fresh claude session; the probe plugin appends saved note KIWI-9 at agent_end)"
    PROBE_NOTE=KIWI-9 turn 1 "Remember: the vault codeword is PINEAPPLE-7. Reply STORED."
    mark "turn2 (account A, resumed claude session)"; turn 2 "What is the harness note?" ;;
  note-resumed-reassign-before-send)
    export FAKE_WRITE_TRANSCRIPT=1; write_probe_config
    mark "turn1 (account A, fresh claude session; the probe plugin appends saved note KIWI-9 at agent_end)"
    PROBE_NOTE=KIWI-9 turn 1 "Remember: the vault codeword is PINEAPPLE-7. Reply STORED."
    mark "turn2 (account A at launch, resumed claude session; login reassigned to B while claude initializes, before the prompt is sent)"
    FAKE_ON_INIT="$SWITCH_TO_B" turn 2 "What is the harness note?"
    eval "$SWITCH_TO_A"
    mark "turn3 (back on account A, resumed claude session)"; turn 3 "What is the harness note?" ;;
  note-resumed-revoke-before-send)
    export FAKE_WRITE_TRANSCRIPT=1; write_probe_config
    mark "turn1 (account A, fresh claude session; the probe plugin appends saved note KIWI-9 at agent_end)"
    PROBE_NOTE=KIWI-9 turn 1 "Remember: the vault codeword is PINEAPPLE-7. Reply STORED."
    mark "turn2 (account A at launch, resumed claude session; credential removed while claude initializes, before the prompt is sent)"
    FAKE_ON_INIT="$REVOKE" turn 2 "What is the harness note?"
    eval "$SWITCH_TO_A"
    mark "turn3 (credential back for account A, resumed claude session)"; turn 3 "What is the harness note?" ;;
  note-append-after-switch)
    # Turn 2's note is appended after the login moved to B (PROBE_NOTE_BEFORE runs the switch).
    export FAKE_WRITE_TRANSCRIPT=1; write_probe_config
    mark "turn1 (account A, fresh claude session; the probe plugin appends saved note KIWI-9 at agent_end)"
    PROBE_NOTE=KIWI-9 turn 1 "Remember: the vault codeword is PINEAPPLE-7. Reply STORED."
    mark "turn2 (account A, resumed claude session; login reassigned to B at agent_end, then the plugin appends saved note FIG-4)"
    PROBE_NOTE=FIG-4 PROBE_NOTE_BEFORE="$SWITCH_TO_B" turn 2 "Remember: the second codeword is BANANA-3. Reply STORED."
    eval "$SWITCH_TO_A"
    mark "turn3 (back on account A, resumed claude session)"; turn 3 "What is the harness note?" ;;
  resumed-allowed)
    # The synthetic child writes a native transcript, so turns 2 and 3 resume the Claude session.
    export FAKE_WRITE_TRANSCRIPT=1
    mark "turn1 (account A, fresh claude session)"; turn 1 "Remember: the vault codeword is PINEAPPLE-7. Reply STORED."
    mark "turn2 (account A, resumed claude session)"; turn 2 "Remember: the second codeword is BANANA-3. Reply STORED."
    mark "turn3 (account A, resumed claude session)"; turn 3 "What are the codewords?" ;;
  resumed-reassign-before-send)
    export FAKE_WRITE_TRANSCRIPT=1
    mark "turn1 (account A, fresh claude session)"; turn 1 "Remember: the vault codeword is PINEAPPLE-7. Reply STORED."
    mark "turn2 (account A at launch, resumed claude session; login reassigned to B while claude initializes, before the prompt is sent)"
    FAKE_ON_INIT="$SWITCH_TO_B" turn 2 "Remember: the second codeword is BANANA-3. Reply STORED."
    eval "$SWITCH_TO_A"
    mark "turn3 (back on account A, resumed claude session)"; turn 3 "What are the codewords?" ;;
  resumed-revoke-before-send)
    export FAKE_WRITE_TRANSCRIPT=1
    mark "turn1 (account A, fresh claude session)"; turn 1 "Remember: the vault codeword is PINEAPPLE-7. Reply STORED."
    mark "turn2 (account A at launch, resumed claude session; credential removed while claude initializes, before the prompt is sent)"
    FAKE_ON_INIT="$REVOKE" turn 2 "Remember: the second codeword is BANANA-3. Reply STORED."
    eval "$SWITCH_TO_A"
    mark "turn3 (credential back for account A, resumed claude session)"; turn 3 "What are the codewords?" ;;
  resumed-coverage-switch)
    export FAKE_WRITE_TRANSCRIPT=1
    mark "turn1 (account A, fresh claude session)"; turn 1 "Remember: the vault codeword is PINEAPPLE-7. Reply STORED."
    mark "turn2 (account A at launch and at send, resumed claude session; login reassigned to B after the prompt was delivered, before the turn is committed)"
    FAKE_ON_USER="$SWITCH_TO_B" turn 2 "Remember: the second codeword is BANANA-3. Reply STORED."
    eval "$SWITCH_TO_A"
    mark "turn3 (back on account A, resumed claude session)"; turn 3 "What are the codewords?" ;;
  *) echo "unknown scenario $SCEN" >&2; exit 2 ;;
esac
DB=$(find "$RUN/state/agents" -name openclaw-agent.sqlite | head -1)
{ node "$H/transcript.mjs" "$DB" 2>/dev/null; } > "$RUN/transcript-and-boundary.txt"
echo done > "$RUN/DONE"
