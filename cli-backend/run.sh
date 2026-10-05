#!/bin/bash
export PATH=$HOME/homebrew/bin:$PATH
R=${R:-$HOME/work/pr165112r2/src}; W=$HOME/work/pr165112r2/cli; P=$W/p; PORT=20300
rm -rf "$P"
red() { sed -e "s#$P#<profile>#g" -e "s#$HOME#~#g"; }
cli() { ( cd "$R" && env -i HOME="$P" OPENCLAW_HOME="$P" OPENCLAW_STATE_DIR="$P/state" OPENCLAW_CONFIG_PATH="$P/openclaw.json" OPENCLAW_NO_RESPAWN=1 NO_COLOR=1 CI=1 PATH="$W:$PATH" TMPDIR="$P" LANG=en_US.UTF-8 STUB_LOG="$P/stub.log" node dist/index.js "$@" 2>&1 ); }
gw() { node --import $R/scripts/tsx.mjs $W/gw-cli.mjs --repo $R --root "$P" --port $PORT --label $1 --turns $2 2>&1 | red; }
{
node --import $R/scripts/tsx.mjs $HOME/work/pr165112r2/proof/setup-profile.mjs --repo $R --root "$P" --port $PORT --case subdir
node -e 'const fs=require("fs");const p=process.argv[1]+"/openclaw.json";const c=JSON.parse(fs.readFileSync(p,"utf8"));c.agents.defaults.model={primary:"claude-cli/claude-sonnet-5"};c.agents.defaults.models={...(c.agents.defaults.models||{}),"claude-cli/claude-sonnet-5":{}};fs.writeFileSync(p,JSON.stringify(c,null,2)+"\n")' "$P"
echo "## config: model + entries before"; node -e 'const c=require(process.argv[1]);console.log(JSON.stringify({model:c.agents.defaults.model,workspace:c.agents.defaults.workspace,entries:c.agents.entries}))' "$P/openclaw.json" | red
echo; echo "## Gateway run 1 (before pin): two operator turns on agent:main:main via the claude-cli backend (stub claude)"
gw before 2
echo; echo "## stub log after run 1"; red < "$P/stub.log"
echo; echo "## openclaw doctor --fix --non-interactive (pins agents.entries.main.workspace)"
cli doctor --fix --non-interactive | red | grep -E -A3 "Set agents.entries|Updated config"
node -e 'const c=require(process.argv[1]);console.log("agents.entries =",JSON.stringify(c.agents.entries))' "$P/openclaw.json" | red
echo; echo "## Gateway run 2 (after pin, new Gateway process, same session store): two operator turns"
: > "$P/stub.mark"; N=$(wc -l < "$P/stub.log")
gw after 2
echo; echo "## stub log new lines after run 2"; tail -n +$((N+1)) "$P/stub.log" | red
echo; echo "## gateway log: session invalidation lines"; grep -hiE "invalidat|cwd|fresh session|resume" "$P"/gateway-after.log | red | head -15
} > $W/cli-transition.out 2>&1
echo finished
