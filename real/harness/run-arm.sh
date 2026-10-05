#!/bin/bash
# usage: run-arm.sh <tree> <label> <mode: recover|switch> [model]
# Real built openclaw (agent --local), real claude binary, real Anthropic login used in place (HOME is the
# real HOME). OpenClaw state/config are isolated scratch dirs. The production gateway is not involved.
set -u
TREE=$1; LABEL=$2; MODE=$3; MODEL=${4:-claude-cli/claude-haiku-4-5}
BASE=${BASE:-$HOME/oc164796e}
RUN=$BASE/runs/$LABEL
rm -rf "$RUN"; mkdir -p "$RUN/state" "$RUN/workspace"
printf '{"agents":{"defaults":{"workspace":"%s"}},"plugins":{"entries":{"acpx":{"enabled":false}}}}' "$RUN/workspace" > "$RUN/openclaw.json"
CANARY="PINEAPPLE-$(( (RANDOM<<15|RANDOM) % 9000000000 + 1000000000 ))"
echo "$CANARY" > "$RUN/canary.txt"
projdirs() { find "$HOME/.claude/projects" -maxdepth 1 -name '*oc164796e*' 2>/dev/null; }
turn() { # n message [extra env assignments...]
  local n=$1 msg=$2; shift 2
  echo "--- turn $n: $msg" >> "$RUN/turns.log"
  ( cd "$RUN" && env -i HOME="$HOME" PATH="$HOME/.local/bin:$HOME/homebrew/bin:/opt/homebrew/bin:/usr/bin:/bin" USER="$USER" \
      OPENCLAW_STATE_DIR="$RUN/state" OPENCLAW_CONFIG_PATH="$RUN/openclaw.json" OPENCLAW_GATEWAY_PORT=18991 "$@" \
      node "$TREE/openclaw.mjs" agent --local --agent main --session-id e-session --message "$msg" \
      --model "$MODEL" --json > "$RUN/turn$n.out" 2> "$RUN/turn$n.err" )
  echo "turn $n exit=$?" >> "$RUN/turns.log"
  local dbf; dbf=$(find "$RUN/state/agents" -name openclaw-agent.sqlite 2>/dev/null | head -1)
  [ -n "$dbf" ] && echo "after turn $n: $(node "$BASE/boundary.mjs" "$dbf" 2>&1)" >> "$RUN/boundary-by-turn.txt"
}
Q2="What is the vault codeword I told you earlier in this conversation? Do not use any tools and do not search files, memory or sessions: answer only from this conversation. Reply with only the codeword, or UNKNOWN if you do not know it."
turn 1 "Remember this for later: the vault codeword is $CANARY. Reply with only the word STORED."
# Drop the Claude session: delete this run's own Claude project dir (transcript and auto-memory) so the next
# turn cannot --resume. Same OpenClaw conversation (same session id and SQLite state).
projdirs > "$RUN/dropped-project-dirs.txt"; projdirs | while read -r d; do rm -rf "$d"; done
echo "claude project dirs left after drop: $(projdirs | wc -l | tr -d ' ')" >> "$RUN/turns.log"
if [ "$MODE" = switch ]; then
  S=$RUN/synthetic-claude-config; mkdir -p "$S"
  printf '{"oauthAccount":{"accountUuid":"00000000-0000-4000-8000-00000000b0b0","emailAddress":"synthetic-b@example.invalid"}}' > "$S/.claude.json"
  printf '{"claudeAiOauth":{"accessToken":"synthetic-not-a-real-token","expiresAt":1893456000000}}' > "$S/.credentials.json"
  turn 2 "$Q2" CLAUDE_CONFIG_DIR="$S"
else
  turn 2 "$Q2"
fi
projdirs | while read -r d; do rm -rf "$d"; done
echo "canary=$CANARY" >> "$RUN/turns.log"
