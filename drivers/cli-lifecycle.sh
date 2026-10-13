#!/bin/bash
# usage: cli-lifecycle.sh <port>
# Source build of this tree. A claude-cli conversation stored in the shared root; `doctor --fix` with a
# read-only config (the pin is not published); more turns in the root; then a normal `doctor --fix`.
export PATH=$HOME/homebrew/bin:$PATH
PORT=$1
R=${R:-$HOME/work/pr-165112}; B=$HOME/work/pr-165112-ev; D=$B/drivers; W=$B/lifecycle; P=$W/profile
rm -rf "$W"; mkdir -p "$W"
red() { sed -e "s#$P#<profile>#g" -e "s#$B#<work>#g" -e "s#$HOME#~#g"; }
penv() { env -i HOME="$P" OPENCLAW_HOME="$P" OPENCLAW_STATE_DIR="$P/state" OPENCLAW_CONFIG_PATH="$P/openclaw.json" OPENCLAW_NO_RESPAWN=1 NO_COLOR=1 CI=1 PATH="$B/cli:$PATH" TMPDIR="$P" LANG=en_US.UTF-8 OPENAI_API_KEY=synthetic-proof-not-a-real-key STUB_LOG="$P/stub.log" "$@"; }
doctor() { CLIARGS=(doctor --fix --non-interactive); ( cd "$R" && penv "$@" node dist/index.js "${CLIARGS[@]}" 2>&1 ); }
binding() { node $D/binding.js "$P"; }
gw() { N=$(wc -l < "$P/stub.log" 2>/dev/null || echo 0); node --import $R/scripts/tsx.mjs $D/gw-cli.mjs --repo $R --stubdir $B/cli --root "$P" --port $PORT --label $1 --turns $2 2>&1 | red; echo "-- conversation spawns and turns:"; tail -n +$((N+1)) "$P/stub.log" | grep -v '"sessionId":"stub-session"' | grep -v '"ev":"control"' | red; }
cfgline() { node -e 'const c=require(process.argv[1]);console.log("agents.entries =",JSON.stringify(c.agents.entries))' "$P/openclaw.json" | red; }
{
echo "# claude-cli lifecycle (head $(cd $R && git rev-parse --short=11 HEAD))"
node --import $R/scripts/tsx.mjs $D/setup-profile.mjs --repo $R --root "$P" --port $PORT --case subdir
node -e 'const fs=require("fs");const p=process.argv[1]+"/openclaw.json";const c=JSON.parse(fs.readFileSync(p,"utf8"));c.agents.defaults.model={primary:"claude-cli/claude-sonnet-5"};c.agents.defaults.models={...(c.agents.defaults.models||{}),"claude-cli/claude-sonnet-5":{}};fs.writeFileSync(p,JSON.stringify(c,null,2)+"\n")' "$P"
echo; echo "## 1. Gateway, two turns (unpinned: the conversation starts in the shared root)"; gw first 2
binding; cfgline
echo; echo "## 2. openclaw doctor --fix --non-interactive with OPENCLAW_CONFIG_READONLY=1 (the pin cannot be published)"
doctor OPENCLAW_CONFIG_READONLY=1 > $W/doctor-readonly.log; echo "exit=$?"
grep -E "Carried|Copied|Set agents|read-only|readonly|not written|external" $W/doctor-readonly.log | sed -E 's/^[│ ]+//; s/ +│$//' | red | head -12
cfgline; binding; echo "-- Claude project folders:"; $D/projects.sh "$P" | red
echo; echo "## 3. Gateway start without turns (the agent database finishes the inspection Doctor left pending), then a Gateway with one more turn (still unpinned, in the shared root)"; gw settle 0 > /dev/null; gw refused 1
binding; echo "-- Claude project folders:"; $D/projects.sh "$P" | red
echo; echo "## 4. openclaw doctor --fix --non-interactive"
doctor > $W/doctor-fix.log; echo "exit=$?"
grep -E "Carried|Copied|Set agents|Doctor did not" $W/doctor-fix.log | sed -E 's/^[│ ]+//; s/ +│$//' | red | head -12
cfgline; binding; echo "-- Claude project folders:"; $D/projects.sh "$P" | red
echo; echo "## 5. Gateway, two turns (pinned)"; gw pinned 2
binding; echo "-- Claude project folders:"; $D/projects.sh "$P" | red
echo; echo "## candidate gateway logs: CLI session reuse lines"; for l in first settle refused pinned; do echo "-- $l"; grep -hE "cli exec: .*trigger=user|cli session reset" "$P/gateway-$l.log" | sed -E 's/^[0-9T:.+-]+ //' | red; done
} > $W/cli-lifecycle.out 2>&1
echo "done lifecycle" > lifecycle.done
