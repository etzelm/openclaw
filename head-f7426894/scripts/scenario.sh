#!/bin/bash
# usage: scenario.sh <tree-dir> <label> <scenario>
# Real built openclaw (`node <tree>/openclaw.mjs agent --local`), real SQLite session, real
# native-login files on disk (synthetic values), real Anthropic Claude runtime and stream-json
# transport. Synthetic pieces: the claude executable (bin/claude, records what reaches its
# stdin), a STUB of Anthropic's OAuth profile endpoint (profile-stub.mjs, reached through
# shim/profile-fetch-shim.mjs), and Claude's admin-managed settings root, which
# shim/managed-settings-shim.mjs redirects from /Library/Application Support/ClaudeCode to the
# per-run fixture dir $RUN/managed. The real system dir is never created or written.
set -u
S=$SCRATCH
export PATH=$S/upstream/node24bin:$PATH
TREE=$1; LABEL=$2; SCEN=$3
H=${HARNESS_DIR:-$S/pr178929/harness}
RUN=$H/runs/$LABEL-$SCEN
rm -rf "$RUN"; mkdir -p "$RUN/home" "$RUN/state"
LOGIN=$RUN/claude-config
export HOME=$RUN/home
export OPENCLAW_STATE_DIR=$RUN/state
export OPENCLAW_CONFIG_PATH=$RUN/openclaw.json
optin() { node "$H/optin.mjs" "$OPENCLAW_CONFIG_PATH" "$([ "${HARNESS_ATTEST:-1}" = 1 ] && echo on || echo off)"; }
export CLAUDE_CONFIG_DIR=$LOGIN
export PATH=$H/bin:$PATH
export FAKE_CLAUDE_LOG=$RUN/fake-claude.log
export USER=harness-user
# Managed-settings fixture (synthetic values only).
MANAGED=$RUN/managed
export FAKE_MANAGED_DIR=$MANAGED
export FAKE_MANAGED_LOG=$RUN/managed-redirect.log
: > "$FAKE_MANAGED_LOG"
mkdir -p "$MANAGED"
managed_control() { printf '{"env":{"DISABLE_TELEMETRY":"1"}}' > "$MANAGED/managed-settings.json"; }
managed_env() { printf '{"env":{"DISABLE_TELEMETRY":"1","ANTHROPIC_API_KEY":"synthetic"}}' > "$MANAGED/managed-settings.json"; }
ADD_HELPER="mkdir -p '$MANAGED/managed-settings.d' && printf '{\"apiKeyHelper\":\"echo synthetic\"}' > '$MANAGED/managed-settings.d/50-auth.json'"
echo ok > "$RUN/profile-mode"
node "$H/profile-stub.mjs" "$RUN/profile-mode" "$FAKE_CLAUDE_LOG" "$RUN/profile-port" &
STUB=$!
trap 'kill $STUB 2>/dev/null' EXIT
for _ in $(seq 50); do [ -s "$RUN/profile-port" ] && break; sleep 0.1; done
export FAKE_PROFILE_PORT=$(cat "$RUN/profile-port")
export NODE_OPTIONS="--import $H/shim/profile-fetch-shim.mjs --import $H/shim/managed-settings-shim.mjs ${EXTRA_NODE_OPTIONS:-}"
mkdir -p "$RUN/workspace"
write_config() {
  printf '{"agents":{"defaults":{"workspace":"%s"}}}' "$RUN/workspace" > "$OPENCLAW_CONFIG_PATH"; optin
}
# The probe-note plugin (plugins/probe-note) appends one saved note at a chosen hook of a turn.
write_probe_config() {
  printf '{"agents":{"defaults":{"workspace":"%s"}},"plugins":{"load":{"paths":["%s"]},"entries":{"probe-note":{"enabled":true,"hooks":{"allowConversationAccess":true}}}}}' "$RUN/workspace" "$H/plugins/probe-note" > "$OPENCLAW_CONFIG_PATH"; optin
}
write_config
write_account() { # dir uuid
  mkdir -p "$1"
  printf '{"oauthAccount":{"accountUuid":"%s","emailAddress":"%s@example.invalid"}}' "$2" "$2" > "$1/.claude.json"
  printf '{"claudeAiOauth":{"accessToken":"synthetic-%s","expiresAt":1893456000000}}' "$2" > "$1/.credentials.json"
}
turn() { # n message
  echo "--- turn $1: $2" >> "$RUN/turns.log"
  echo "turn $1 tree=$TREE session=${SESSION_ID:-harness-session}" >> "$RUN/turns.log"
  echo "managed fixture before turn $1: $(cd "$MANAGED" && find . -type f | sort | tr '\n' ' ')" >> "$RUN/turns.log"
  ( export HARNESS_TURN=$1; cd "$RUN" && node "$TREE/openclaw.mjs" agent --local --agent main --session-id "${SESSION_ID:-harness-session}" \
      --message "$2" --model claude-cli/claude-sonnet-5 --json > "$RUN/turn$1.out" 2> "$RUN/turn$1.err" )
  echo "turn $1 exit=$?" >> "$RUN/turns.log"
  echo "managed fixture after turn $1: $(cd "$MANAGED" && find . -type f | sort | tr '\n' ' ')" >> "$RUN/turns.log"
  DBF=$(find "$RUN/state/agents" -name openclaw-agent.sqlite 2>/dev/null | head -1)
  [ -n "$DBF" ] && echo "after turn $1: $(node "$H/boundary.mjs" "$DBF" 2>&1)" >> "$RUN/boundary-by-turn.txt"
}
mark() { echo "=== $1" >> "$RUN/fake-claude.log"; }

write_account "$LOGIN" account-A
managed_control
STORE="Remember: the vault codeword is PINEAPPLE-7. Reply STORED."
ASK="What is the codeword?"
case "$SCEN" in
  managed-control)
    mark "turn1 (account A, managed control fixture)"; turn 1 "$STORE"
    mark "turn2 (account A, managed control fixture, fresh claude session)"; turn 2 "$ASK" ;;
  managed-static-env)
    mark "turn1 (account A, managed control fixture)"; turn 1 "$STORE"
    managed_env
    mark "turn2 (managed-settings.json env sets ANTHROPIC_API_KEY before the turn, fresh claude session)"; turn 2 "$ASK" ;;
  managed-static-helper)
    mark "turn1 (account A, managed control fixture)"; turn 1 "$STORE"
    eval "$ADD_HELPER"
    mark "turn2 (managed-settings.d/50-auth.json sets apiKeyHelper before the turn, fresh claude session)"; turn 2 "$ASK" ;;
  managed-before-send)
    mark "turn1 (account A, managed control fixture)"; turn 1 "$STORE"
    mark "turn2 (prepared and admitted under account A; apiKeyHelper drop-in added while claude initializes, before the prompt is sent; fresh claude session)"
    FAKE_ON_INIT="$ADD_HELPER" turn 2 "$ASK" ;;
  resumed-managed-control|resumed-managed-before-send|resumed-managed-before-context)
    # The synthetic child writes a native transcript, so turn 2 resumes the Claude session. On a
    # resumed session OpenClaw sends no recovery prompt; the turn's private saved context travels
    # only in the UserPromptSubmit hook answer (the history-gated "Conversation data" block).
    export FAKE_WRITE_TRANSCRIPT=1
    mark "turn1 (account A, managed control fixture, fresh claude session)"; turn 1 "$STORE"
    case "$SCEN" in
      resumed-managed-control)
        mark "turn2 (account A, managed control fixture, resumed claude session)"; turn 2 "$ASK" ;;
      resumed-managed-before-send)
        mark "turn2 (account A at launch, resumed claude session; apiKeyHelper drop-in added while claude initializes, before the prompt is sent)"
        FAKE_ON_INIT="$ADD_HELPER" turn 2 "$ASK" ;;
      resumed-managed-before-context)
        mark "turn2 (account A at launch and send, resumed claude session; apiKeyHelper drop-in added after the prompt arrived, before the prompt hook is answered)"
        FAKE_BEFORE_CONTEXT="$ADD_HELPER" turn 2 "$ASK" ;;
    esac ;;
  note-resumed-probe)
    # Documentation row: a saved note appended through the plugin SDK (probe-note, KIWI-9) is not
    # covered by the turn's history writer at any hook, so the conversation is no longer owned.
    export FAKE_WRITE_TRANSCRIPT=1; write_probe_config
    export PROBE_NOTE_HOOK=${PROBE_NOTE_HOOK:-agent_end}
    mark "turn1 (account A, fresh claude session; the probe plugin appends saved note KIWI-9 at $PROBE_NOTE_HOOK)"
    PROBE_NOTE=KIWI-9 turn 1 "$STORE"
    mark "turn2 (account A, managed control fixture, resumed claude session)"; turn 2 "$ASK" ;;
  *) echo "unknown scenario $SCEN" >&2; exit 2 ;;
esac
DB=$(find "$RUN/state/agents" -name openclaw-agent.sqlite | head -1)
{ node "$H/transcript.mjs" "$DB" 2>/dev/null; } > "$RUN/transcript-and-boundary.txt"
echo done > "$RUN/DONE"
