#!/bin/bash
# usage: interactive.sh <port> : root-only profile; interactive `openclaw doctor` declined, then accepted.
export PATH=$HOME/homebrew/bin:$PATH
PORT=$1
R=${R:-$HOME/work/pr-165112}; B=$HOME/work/pr-165112-ev; D=$B/drivers; W=$B/interactive; P=$W/profile
G=$W/gprefix; TGZ=$B/pack/openclaw-candidate.tgz
rm -rf "$W"; mkdir -p "$W"
red() { sed -e "s#$P#<profile>#g" -e "s#$B#<work>#g" -e "s#$HOME#~#g"; }
penv() { env -i NPM_CONFIG_PREFIX="$G" HOME="$P" OPENCLAW_HOME="$P" OPENCLAW_STATE_DIR="$P/state" OPENCLAW_CONFIG_PATH="$P/openclaw.json" OPENCLAW_NO_RESPAWN=1 NO_COLOR=1 PATH="$G/bin:$PATH" TMPDIR="$P" LANG=en_US.UTF-8 TERM=xterm-256color OPENAI_API_KEY=synthetic-proof-not-a-real-key "$@"; }
tree() { ( cd "$1" && find . -type f -not -path "./main/.git/*" | sort | while read f; do echo "$(shasum -a 256 "$f" | cut -c1-16)  $f"; done ); }
cfgline() { node -e 'const c=require(process.argv[1]);console.log("agents.entries =",JSON.stringify(c.agents.entries))' "$P/openclaw.json" | red; }
gw() { node --import $R/scripts/tsx.mjs $D/gw-turns.mjs --repo $R --root "$P" --port $PORT --label $1 2>&1 | red; }
{
echo "# interactive doctor (head $(cd $R && git rev-parse --short=11 HEAD))"
NPM_CONFIG_PREFIX="$G" npm_config_cache="$B/npm-cache" npm install -g --no-audit --no-fund "$TGZ" > $W/npm-install.log 2>&1; echo "npm install -g <candidate.tgz> exit=$?"
echo "installed: $(penv openclaw --version 2>&1 | tail -1)"
node --import $R/scripts/tsx.mjs $D/setup-profile.mjs --repo $R --root "$P" --port $PORT --case root
gw before > /dev/null
echo "## workspace before (sha256 prefix, main/.git omitted)"; tree "$P/workspace" | tee $W/tree-before.txt
for mode in decline accept; do
  echo; echo "## openclaw doctor (interactive, no --fix), answer: $mode"
  ( cd "$W" && penv expect -f $D/doctor-interactive.exp $mode ) > $W/doctor-$mode.log 2>&1; echo "exit=$?"
  sed -e 's/\x1b\[[0-9;?]*[a-zA-Z]//g' $W/doctor-$mode.log | tr -d '\r' | grep -E "Apply recommended|Yes|No|Copy|Copied|Carry|Set agents|copies them|OTHER PROMPT|Updated config" | sed -E 's/^[│◆◇●○ ]+//; s/ +│$//' | red | uniq | head -20
  cfgline
  tree "$P/workspace" > $W/tree-after-$mode.txt; echo "-- workspace vs before:"; diff $W/tree-before.txt $W/tree-after-$mode.txt && echo "identical"
done
echo; gw after
} > $W/interactive.out 2>&1
echo "done interactive"
