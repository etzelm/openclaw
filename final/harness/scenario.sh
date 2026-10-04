#!/bin/bash
# usage: scenario.sh <tree-dir> <label> <scenario>
# Real built openclaw (`agent --local`), real SQLite session, real native-login files on disk,
# real Anthropic Claude runtime and stream-json transport. Only the claude executable is a
# synthetic child (harness/bin/claude) that records what reaches its stdin.
set -u
export PATH=$HOME/homebrew/bin:$PATH
TREE=$1; LABEL=$2; SCEN=$3
H=$HOME/work/164796-harness
RUN=$H/runs/$LABEL-$SCEN
rm -rf "$RUN"; mkdir -p "$RUN/home" "$RUN/state"
LOGIN=$RUN/claude-config
export HOME=$RUN/home
export OPENCLAW_STATE_DIR=$RUN/state
export OPENCLAW_CONFIG_PATH=$RUN/openclaw.json
export CLAUDE_CONFIG_DIR=$LOGIN
export PATH=$H/bin:$PATH
export FAKE_CLAUDE_LOG=$RUN/fake-claude.log
export USER=harness-user
mkdir -p "$RUN/workspace/skills/harness-skill"
printf -- '---\nname: harness-skill\ndescription: Harness skill whose config injects an environment variable.\n---\nNo instructions.\n' > "$RUN/workspace/skills/harness-skill/SKILL.md"
SKILL_LOGIN=$RUN/skill-claude-config
write_config() { # optional skill CLAUDE_CONFIG_DIR value
  if [ -n "${1:-}" ]; then
    printf '{"agents":{"defaults":{"workspace":"%s"}},"skills":{"entries":{"harness-skill":{"env":{"CLAUDE_CONFIG_DIR":"%s"}}}}}' "$RUN/workspace" "$1" > "$OPENCLAW_CONFIG_PATH"
  else
    printf '{"agents":{"defaults":{"workspace":"%s"}}}' "$RUN/workspace" > "$OPENCLAW_CONFIG_PATH"
  fi
}
write_config
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
  ( cd "$RUN" && node "$TREE/openclaw.mjs" agent --local --agent main --session-id harness-session \
      --message "$2" --model claude-cli/claude-sonnet-5 --json > "$RUN/turn$1.out" 2> "$RUN/turn$1.err" )
  echo "turn $1 exit=$?" >> "$RUN/turns.log"
}
mark() { echo "=== $1" >> "$RUN/fake-claude.log"; }

login account-A
case "$SCEN" in
  allowed)
    mark "turn1 (account A)"; turn 1 "Remember: the vault codeword is PINEAPPLE-7. Reply STORED."
    mark "turn2 (account A, fresh claude session)"; turn 2 "What is the codeword?" ;;
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
    export NODE_OPTIONS="--import $H/shim/security-shim.mjs"
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
  *) echo "unknown scenario $SCEN" >&2; exit 2 ;;
esac
echo done > "$RUN/DONE"
