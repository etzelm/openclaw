#!/bin/bash
# usage: cli-real.sh <port>
# Source build of this tree with the real Claude Code executable. A claude-cli conversation stored in the
# shared root; `doctor --fix` with a read-only config (the pin is not published); more turns in the root;
# then a normal `doctor --fix`; then turns under the pin. Each turn asks Claude to recall earlier turns.
export PATH=$HOME/homebrew/bin:$PATH
PORT=$1
R=${R:-$HOME/work/pr-165112}; B=$HOME/work/pr-165112-ev; D=$B/drivers; W=$B/lifecycle-real; P=$W/profile
rm -rf "$W" "$B/cli-real"; mkdir -p "$W" "$B/cli-real"
ln -s "$(readlink -f "$(command -v claude)")" "$B/cli-real/claude"
red() { sed -e "s#$P#<profile>#g" -e "s#$B#<work>#g" -e "s#$HOME#~#g"; }
penv() { env -i HOME="$P" OPENCLAW_HOME="$P" OPENCLAW_STATE_DIR="$P/state" OPENCLAW_CONFIG_PATH="$P/openclaw.json" OPENCLAW_NO_RESPAWN=1 NO_COLOR=1 CI=1 PATH="$B/cli-real:$PATH" TMPDIR="$P" LANG=en_US.UTF-8 OPENAI_API_KEY=synthetic-proof-not-a-real-key "$@"; }
doctor() { CLIARGS=(doctor --fix --non-interactive); ( cd "$R" && penv "$@" node dist/index.js "${CLIARGS[@]}" 2>&1 ); }
binding() { node $D/binding.js "$P"; }
gw() { local label=$1; shift; local args=(); for m in "$@"; do args+=(--message "$m"); done; node --import $R/scripts/tsx.mjs $D/gw-real.mjs --repo $R --stubdir $B/cli-real --root "$P" --port $PORT --label $label "${args[@]}" 2>&1 | red; }
cfgline() { node -e 'const c=require(process.argv[1]);console.log("agents.entries =",JSON.stringify(c.agents.entries))' "$P/openclaw.json" | red; }
projects() { echo "-- Claude project folders:"; $D/projects-real.sh "$P" | red; }
{
echo "# claude-cli lifecycle with real Claude Code (head $(cd $R && git rev-parse --short=11 HEAD))"
echo "claude --version: $($B/cli-real/claude --version)"
node --import $R/scripts/tsx.mjs $D/setup-profile.mjs --repo $R --root "$P" --port $PORT --case subdir
node -e 'const fs=require("fs");const p=process.argv[1]+"/openclaw.json";const c=JSON.parse(fs.readFileSync(p,"utf8"));c.agents.defaults.model={primary:"claude-cli/claude-sonnet-5"};c.agents.defaults.models={...(c.agents.defaults.models||{}),"claude-cli/claude-sonnet-5":{}};fs.writeFileSync(p,JSON.stringify(c,null,2)+"\n")' "$P"
mkdir -p "$P/.claude" && cp ~/.claude/.credentials.json "$P/.claude/" && chmod 600 "$P/.claude/.credentials.json"
echo "credential: a Claude Code setup token copied to <profile>/.claude/.credentials.json (not shown)"
echo; echo "## 1. Gateway, two turns (unpinned: the conversation starts in the shared root)"
gw first "Remember this codeword for later: PLUM-7731. Reply with only the word: noted" "Also remember the color teal. Reply with only the word: noted"
binding; cfgline; projects
echo; echo "## 2. openclaw doctor --fix --non-interactive with OPENCLAW_CONFIG_READONLY=1 (the pin cannot be published)"
doctor OPENCLAW_CONFIG_READONLY=1 > $W/doctor-readonly.log; echo "exit=$?"
grep -E "Carried|Copied|Set agents|read-only|readonly|not written|external" $W/doctor-readonly.log | sed -E 's/^[│ ]+//; s/ +│$//' | red | head -12
cfgline; binding; projects
echo; echo "## 3. Gateway start without turns (the agent database finishes the inspection Doctor left pending), then a Gateway with two more turns (still unpinned, in the shared root)"
gw settle > /dev/null
gw refused "What codeword and color did I ask you to remember earlier in this conversation? Reply with only the codeword and the color." "Also remember the number 42. Reply with only the word: noted"
binding; projects
echo; echo "## 4. openclaw doctor --fix --non-interactive"
doctor > $W/doctor-fix.log; echo "exit=$?"
grep -E "Carried|Copied|Set agents|Doctor did not" $W/doctor-fix.log | sed -E 's/^[│ ]+//; s/ +│$//' | red | head -12
cfgline; binding; projects
echo; echo "## 5. Gateway, one turn (pinned)"
gw pinned "List the codeword, the color and the number I asked you to remember in this conversation. Reply with only those three values."
binding; projects
echo; echo "## Gateway logs: CLI session reuse lines"; for l in first settle refused pinned; do echo "-- $l"; grep -hE "cli exec: .*trigger=user|cli session reset" "$P/gateway-$l.log" | sed -E 's/^[0-9T:.+-]+ //' | red; done
} > $W/cli-real.out 2>&1
rm -f "$P/.claude/.credentials.json"
echo done > $B/lifecycle-real.done
