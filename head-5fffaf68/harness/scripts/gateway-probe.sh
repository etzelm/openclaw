#!/bin/bash
# usage: gateway-probe.sh <tree> <label> <scenario>
# Real built Gateway (`openclaw gateway run`) on an isolated state dir with the same synthetic login,
# synthetic Claude child and profile STUB as scenario.sh. Turn 2 goes through the Gateway and the
# Gateway is killed while the profile STUB holds turn 2's attestation request (turn preparation, before
# the user message is written), so the Gateway-staged input is left unfinished.
# Turn 3 runs with `openclaw agent --local` on the same conversation.
set -u
export PATH=$HOME/homebrew/bin:$PATH
TREE=$1; LABEL=$2; SCEN=$3
H=${HARNESS_DIR:-$HOME/work/pr-164796-h/harness}
RUN=$H/runs/$LABEL-$SCEN
rm -rf "$RUN"; mkdir -p "$RUN/home" "$RUN/state" "$RUN/workspace"
LOGIN=$RUN/claude-config
export HOME=$RUN/home OPENCLAW_STATE_DIR=$RUN/state OPENCLAW_CONFIG_PATH=$RUN/openclaw.json
# The operator's opt-in to native login attestation (optin.mjs). HARNESS_ATTEST=0 leaves it unset.
optin() { node "$H/optin.mjs" "$OPENCLAW_CONFIG_PATH" "$([ "${HARNESS_ATTEST:-1}" = 1 ] && echo on || echo off)"; }
export CLAUDE_CONFIG_DIR=$LOGIN PATH=$H/bin:$PATH FAKE_CLAUDE_LOG=$RUN/fake-claude.log USER=harness-user
export FAKE_WRITE_TRANSCRIPT=1
echo ok > "$RUN/profile-mode"
node "$H/profile-stub.mjs" "$RUN/profile-mode" "$FAKE_CLAUDE_LOG" "$RUN/profile-port" &
STUB=$!
GW=
trap 'kill $STUB 2>/dev/null; [ -n "$GW" ] && kill -9 $GW 2>/dev/null' EXIT
for _ in $(seq 50); do [ -s "$RUN/profile-port" ] && break; sleep 0.1; done
export FAKE_PROFILE_PORT=$(cat "$RUN/profile-port")
export NODE_OPTIONS="--import $H/shim/profile-fetch-shim.mjs"
PORT=$(( 20000 + RANDOM % 20000 ))
printf '{"agents":{"defaults":{"workspace":"%s","model":{"primary":"claude-cli/claude-sonnet-5"}}},"gateway":{"mode":"local","port":%s,"bind":"loopback","auth":{"mode":"token","token":"harness-token"}}}' "$RUN/workspace" "$PORT" > "$OPENCLAW_CONFIG_PATH"; optin
write_account() { mkdir -p "$1"
  printf '{"oauthAccount":{"accountUuid":"%s","emailAddress":"%s@example.invalid"}}' "$2" "$2" > "$1/.claude.json"
  printf '{"claudeAiOauth":{"accessToken":"synthetic-%s","expiresAt":1893456000000}}' "$2" > "$1/.credentials.json"; }
write_account "$LOGIN" account-A
SWITCH_TO_B="printf '{\"oauthAccount\":{\"accountUuid\":\"account-B\",\"emailAddress\":\"account-B@example.invalid\"}}' > '$LOGIN/.claude.json'; printf '{\"claudeAiOauth\":{\"accessToken\":\"synthetic-account-B\",\"expiresAt\":1893456000000}}' > '$LOGIN/.credentials.json'"
mark() { echo "=== $1" >> "$FAKE_CLAUDE_LOG"; }
boundary() { DBF=$(find "$RUN/state/agents" -name openclaw-agent.sqlite 2>/dev/null | head -1)
  [ -n "$DBF" ] && echo "after $1: $(node "$H/boundary.mjs" "$DBF" 2>&1)" >> "$RUN/boundary-by-turn.txt"; }
local_turn() { # n message
  echo "--- turn $1 (agent --local): $2" >> "$RUN/turns.log"
  ( cd "$RUN" && node "$TREE/openclaw.mjs" agent --local --agent main --session-id harness-session \
      --message "$2" --model claude-cli/claude-sonnet-5 --json > "$RUN/turn$1.out" 2> "$RUN/turn$1.err" )
  echo "turn $1 exit=$?" >> "$RUN/turns.log"; boundary "turn $1"; }
start_gateway() { # hold-on-user
  ( cd "$RUN" && FAKE_ON_USER="${1:-}" exec node "$TREE/openclaw.mjs" gateway run --port "$PORT" > "$RUN/gateway.log" 2>&1 ) &
  GW=$!
  for _ in $(seq 120); do grep -q "http server listening" "$RUN/gateway.log" 2>/dev/null && break; sleep 0.5; done
  echo "gateway started pid=$GW port=$PORT listening=$(grep -c 'http server listening' "$RUN/gateway.log")" >> "$RUN/turns.log"; }

mark "turn1 (account A, agent --local, fresh claude session)"
local_turn 1 "Remember: the vault codeword is PINEAPPLE-7. Reply STORED."
mark "turn2 (account A, through the Gateway; the STUB holds its attestation request and the Gateway is killed during preparation)"
start_gateway
echo timeout > "$RUN/profile-mode"
echo "--- turn 2 (agent via Gateway): Remember: the interrupted codeword is MANGO-5. Reply STORED." >> "$RUN/turns.log"
( cd "$RUN" && node "$TREE/openclaw.mjs" agent --agent main --session-id harness-session \
    --message "Remember: the interrupted codeword is MANGO-5. Reply STORED." --json > "$RUN/turn2.out" 2> "$RUN/turn2.err" ) &
CLI=$!
for _ in $(seq 240); do sed -n '/=== turn2/,$p' "$FAKE_CLAUDE_LOG" | grep -q '"status":"held"' && break; sleep 0.25; done
echo "turn 2 attestation held by the STUB: $(sed -n '/=== turn2/,$p' "$FAKE_CLAUDE_LOG" | grep -c '"status":"held"')" >> "$RUN/turns.log"
kill -9 $GW; GW=
for _ in $(seq 20); do lsof -nP -iTCP:$PORT -sTCP:LISTEN >/dev/null 2>&1 || break; sleep 0.5; done
rm -f "$RUN/state/"*.lock 2>/dev/null
pkill -9 -f "$H/bin/claude" 2>/dev/null
echo ok > "$RUN/profile-mode"
echo "gateway killed while turn 2 was held; turn 2 prompts that reached the child: $(sed -n '/=== turn2/,$p' "$FAKE_CLAUDE_LOG" | grep -c '"user-message-received"')" >> "$RUN/turns.log"
kill $CLI 2>/dev/null; wait $CLI 2>/dev/null; echo "turn 2 client exit=$?" >> "$RUN/turns.log"
boundary "turn 2"
case "$SCEN" in
  interrupted-allowed)
    mark "turn3 (account A, agent --local, resumed claude session)"
    local_turn 3 "What was the interrupted codeword?" ;;
  interrupted-reassign-before-send)
    mark "turn3 (account A at launch, resumed claude session; login reassigned to B while claude initializes, before the prompt is sent)"
    FAKE_ON_INIT="$SWITCH_TO_B" local_turn 3 "What was the interrupted codeword?"
    write_account "$LOGIN" account-A
    mark "turn4 (back on account A, resumed claude session)"
    local_turn 4 "What was the interrupted codeword?" ;;
  interrupted-revoke-before-send)
    mark "turn3 (account A at launch, resumed claude session; credential removed while claude initializes, before the prompt is sent)"
    FAKE_ON_INIT="rm -f '$LOGIN/.credentials.json'" local_turn 3 "What was the interrupted codeword?"
    write_account "$LOGIN" account-A
    mark "turn4 (credential back for account A, resumed claude session)"
    local_turn 4 "What was the interrupted codeword?" ;;
  interrupted-reassign-before-context)
    mark "turn3 (account A at launch and at send, resumed claude session; login reassigned to B after the prompt arrived, before the child asks for its UserPromptSubmit context)"
    FAKE_BEFORE_CONTEXT="$SWITCH_TO_B" local_turn 3 "What was the interrupted codeword?"
    write_account "$LOGIN" account-A
    mark "turn4 (back on account A, resumed claude session)"
    local_turn 4 "What was the interrupted codeword?" ;;
  interrupted-revoke-before-context)
    mark "turn3 (account A at launch and at send, resumed claude session; credential removed after the prompt arrived, before the child asks for its UserPromptSubmit context)"
    FAKE_BEFORE_CONTEXT="rm -f '$LOGIN/.credentials.json'" local_turn 3 "What was the interrupted codeword?"
    write_account "$LOGIN" account-A
    mark "turn4 (credential back for account A, resumed claude session)"
    local_turn 4 "What was the interrupted codeword?" ;;
  interrupted-fresh)
    # The native transcript is gone, so turn 3 starts a fresh Claude session with saved history.
    rm -rf "$HOME/.claude/projects" "$CLAUDE_CONFIG_DIR/projects"
    mark "turn3 (account A, agent --local, fresh claude session after the native transcript was removed)"
    local_turn 3 "What was the interrupted codeword?" ;;
esac
DB=$(find "$RUN/state/agents" -name openclaw-agent.sqlite | head -1)
{ node "$H/transcript.mjs" "$DB" 2>/dev/null; } > "$RUN/transcript-and-boundary.txt"
echo done > "$RUN/DONE"
