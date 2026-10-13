#!/bin/bash
# usage: compat.sh <port>
# Data written by published openclaw@$PUBVER (claude-cli conversation in the shared root), copied byte for
# byte to the same path for each arm; each arm runs its own build's `doctor --fix --non-interactive`, then
# its own Gateway with two more turns. Arms: base (main at the PR's base) and head (this tree).
# Digests read every table of every agent/state database, config leaves, workspace and Claude project files.
export PATH=$HOME/homebrew/bin:$PATH
PORT=$1; PUBVER=${PUBVER:-2026.10.2}
B=$HOME/work/pr-165112-ev; R=$HOME/work/pr-165112; BASE=$HOME/work/pr-165112-base; D=$B/drivers
W=$B/compat; P=$W/profile; G=$B/gprefix-compat; PKG=$G/lib/node_modules/openclaw; S=$W/published-state
rm -rf "$W" "$G"; mkdir -p "$W"
red() { sed -e "s#$P#<profile>#g" -e "s#$B#<work>#g" -e "s#$HOME#~#g"; }
penv() { env -i HOME="$P" OPENCLAW_HOME="$P" OPENCLAW_STATE_DIR="$P/state" OPENCLAW_CONFIG_PATH="$P/openclaw.json" OPENCLAW_NO_RESPAWN=1 NO_COLOR=1 CI=1 PATH="$B/cli:$PATH" TMPDIR="$P" LANG=en_US.UTF-8 OPENAI_API_KEY=synthetic-proof-not-a-real-key STUB_LOG="$P/stub.log" "$@"; }
gw() { N=$(wc -l < "$P/stub.log" 2>/dev/null || echo 0); node --import $R/scripts/tsx.mjs $D/gw-cli.mjs --repo $R --dist $1 --stubdir $B/cli --root "$P" --port $PORT --label $2 --turns 2 2>&1 | red; echo "-- conversation spawns and turns:"; tail -n +$((N+1)) "$P/stub.log" | grep -v '"sessionId":"stub-session"' | grep -v '"ev":"control"' | red; }
dig() { node $D/digest.js "$P" "$W/digest-$1.json"; }
cmpd() { echo; echo "## $1 -> $2"; node $D/compare.js "$W/digest-$1.json" "$W/digest-$2.json" | red; }
{
echo "# data-model compatibility: published $PUBVER data, doctor --fix and Gateway per arm (head $(cd $R && git rev-parse --short=11 HEAD), base $(cd $BASE && git rev-parse --short=11 HEAD))"
NPM_CONFIG_PREFIX="$G" npm_config_cache="$B/npm-cache" npm install -g --no-audit --no-fund openclaw@$PUBVER > $W/npm-install.log 2>&1; echo "npm install -g openclaw@$PUBVER exit=$?"
node --import $R/scripts/tsx.mjs $D/setup-profile.mjs --repo $R --root "$P" --port $PORT --case subdir
node -e 'const fs=require("fs");const p=process.argv[1]+"/openclaw.json";const c=JSON.parse(fs.readFileSync(p,"utf8"));c.agents.defaults.model={primary:"claude-cli/claude-sonnet-5"};c.agents.defaults.models={...(c.agents.defaults.models||{}),"claude-cli/claude-sonnet-5":{}};fs.writeFileSync(p,JSON.stringify(c,null,2)+"\n")' "$P"
echo; echo "## Gateway on published $PUBVER ($(penv $G/bin/openclaw --version 2>&1 | tail -1)), two turns: the stored data both arms start from"; gw $PKG published
node $D/binding.js "$P" | red; dig published
cp -a "$P" "$S"
for arm in base head; do
  A=$([ $arm = base ] && echo $BASE || echo $R)
  rm -rf "$P"; cp -a "$S" "$P"
  echo; echo "## arm $arm: $(cd $A && git rev-parse --short=11 HEAD), openclaw doctor --fix --non-interactive"
  ( cd "$A" && penv node dist/index.js doctor --fix --non-interactive > $W/doctor-$arm.log 2>&1 ); echo "exit=$?"
  dig $arm-doctor; node $D/binding.js "$P" | red
  echo; echo "## arm $arm: Gateway from the same build, two turns"; gw $A $arm
  node $D/binding.js "$P" | red; dig $arm-gateway
  mv "$P" "$W/profile-$arm"
done
echo; echo "# differences"
cmpd published base-doctor; cmpd published head-doctor; cmpd base-doctor head-doctor; cmpd base-gateway head-gateway
} > $W/compat.out 2>&1
echo done > $B/compat.done
