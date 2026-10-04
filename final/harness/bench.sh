#!/bin/bash
# usage: bench.sh <tree> <label> <reps>
# Wall seconds and max RSS of real `openclaw agent --local` turns on a file-backed native login
# (real /usr/bin/security, which finds no item and exits 44). Turn 2 is the fresh-session reseed.
set -u
export PATH=$HOME/homebrew/bin:$PATH
TREE=$1; LABEL=$2; REPS=$3
H=$HOME/work/164796-harness
for r in $(seq 1 $REPS); do
  RUN=$H/bench/$LABEL-$r; rm -rf $RUN; mkdir -p $RUN/home $RUN/state $RUN/workspace $RUN/claude-config
  export HOME=$RUN/home OPENCLAW_STATE_DIR=$RUN/state OPENCLAW_CONFIG_PATH=$RUN/openclaw.json CLAUDE_CONFIG_DIR=$RUN/claude-config FAKE_CLAUDE_LOG=$RUN/fake-claude.log USER=harness-user
  export PATH=$H/bin:$PATH
  printf '{"agents":{"defaults":{"workspace":"%s"}}}' "$RUN/workspace" > $OPENCLAW_CONFIG_PATH
  printf '{"oauthAccount":{"accountUuid":"account-A","emailAddress":"a@example.invalid"}}' > $RUN/claude-config/.claude.json
  printf '{"claudeAiOauth":{"accessToken":"synthetic-account-A","expiresAt":1893456000000}}' > $RUN/claude-config/.credentials.json
  for t in 1 2; do
    msg="What is the codeword?"; [ $t = 1 ] && msg="Remember: the vault codeword is PINEAPPLE-7. Reply STORED."
    ( cd $RUN && /usr/bin/time -l node $TREE/openclaw.mjs agent --local --agent main --session-id bench-session --message "$msg" --model claude-cli/claude-sonnet-5 --json > $RUN/turn$t.out 2> $RUN/turn$t.err )
    echo "$LABEL rep=$r turn=$t exit=$? real=$(grep -E ' real ' $RUN/turn$t.err | awk '{print $1}')s maxrss=$(grep 'maximum resident set size' $RUN/turn$t.err | awk '{print $1}')B history=$(grep -c 'historyPrompt=present' $RUN/turn$t.err)"
  done
done
