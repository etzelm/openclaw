#!/bin/bash
# usage: updater.sh <shape> <port>   shapes: subdir (files in <root>/main) | cli (subdir + claude-cli backend with a stored conversation)
#   | prepinned (subdir with agents.entries.main.workspace already authored, so the repair has nothing to write)
# Published openclaw@2026.10.1 runs the profile first (real sessions in its stores), then its own
# `openclaw update --tag <candidate.tgz>`; the candidate Gateway then runs on the same state.
export PATH=$HOME/homebrew/bin:$PATH
SHAPE=$1; PORT=$2
B=$HOME/work/pr-165112-ev; R=$HOME/work/pr-165112; D=$B/drivers; G=$B/gprefix-$SHAPE; TGZ=$B/pack/openclaw-candidate.tgz
W=$B/upd-$SHAPE; P=$W/profile; PKG=$G/lib/node_modules/openclaw
rm -rf "$W" "$G"; mkdir -p "$W"
red() { sed -e "s#$P#<profile>#g" -e "s#$B#<work>#g" -e "s#$HOME#~#g"; }
pub() { env -i HOME="$P" OPENCLAW_HOME="$P" OPENCLAW_STATE_DIR="$P/state" OPENCLAW_CONFIG_PATH="$P/openclaw.json" NPM_CONFIG_PREFIX="$G" npm_config_cache="$B/npm-cache" OPENCLAW_NO_RESPAWN=1 NO_COLOR=1 CI=1 PATH="$G/bin:$B/cli:$PATH" TMPDIR="$P" LANG=en_US.UTF-8 OPENAI_API_KEY=synthetic-proof-not-a-real-key STUB_LOG="$P/stub.log" "$@" 2>&1; }
tree() { ( cd "$1" && find . -type f | sort | while read f; do echo "$(shasum -a 256 "$f" | cut -c1-16)  $f"; done ); }
cfg() { node -e 'const c=require(process.argv[1]);console.log("agents.defaults.workspace =",c.agents.defaults.workspace,"| model =",JSON.stringify(c.agents.defaults.model),"| entries =",JSON.stringify(c.agents.entries))' "$P/openclaw.json" | red; }
gw() { if [ "$SHAPE" = cli ]; then node --import $R/scripts/tsx.mjs $D/gw-cli.mjs --repo $R --dist $PKG --stubdir $B/cli --root "$P" --port $PORT --label $1 --turns 2 2>&1 | red; else node --import $R/scripts/tsx.mjs $D/gw-turns.mjs --repo $R --dist $PKG --root "$P" --port $PORT --label $1 --inspect 2>&1 | red; fi; }
{
echo "# updater shape: $SHAPE (candidate from $(cd $R && git rev-parse --short=11 HEAD), base $(cd $R && git rev-parse --short=11 upstream/main))"
NPM_CONFIG_PREFIX="$G" npm_config_cache="$B/npm-cache" npm install -g --no-audit --no-fund openclaw@2026.10.1 > $W/npm-install.log 2>&1; echo "npm install -g openclaw@2026.10.1 exit=$?"
node --import $R/scripts/tsx.mjs $D/setup-profile.mjs --repo $R --root "$P" --port $PORT --case subdir
if [ "$SHAPE" = prepinned ]; then
  node -e 'const fs=require("fs");const p=process.argv[1]+"/openclaw.json";const c=JSON.parse(fs.readFileSync(p,"utf8"));c.agents.entries.main={workspace:process.argv[1]+"/workspace/main"};fs.writeFileSync(p,JSON.stringify(c,null,2)+"\n")' "$P"
fi
if [ "$SHAPE" = cli ]; then
  node -e 'const fs=require("fs");const p=process.argv[1]+"/openclaw.json";const c=JSON.parse(fs.readFileSync(p,"utf8"));c.agents.defaults.model={primary:"claude-cli/claude-sonnet-5"};c.agents.defaults.models={...(c.agents.defaults.models||{}),"claude-cli/claude-sonnet-5":{}};fs.writeFileSync(p,JSON.stringify(c,null,2)+"\n")' "$P"
fi
echo; echo "## installed (published)"; pub openclaw --version | red
echo; echo "## candidate artifact"; ls -la "$TGZ" | red; tar -xzOf "$TGZ" package/package.json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);console.log(j.name,j.version,"updateAdmissionProtocol=",j.openclaw&&j.openclaw.updateAdmissionProtocol)})'
echo; echo "## config before"; cfg
echo; echo "## Gateway run on published 2026.10.1 (creates the stored sessions the candidate must read)"; gw published
[ "$SHAPE" = cli ] && { echo; echo "## stub log after the published run"; red < "$P/stub.log"; }
tree "$P/workspace" > $W/tree-before.txt; echo; echo "## workspace before update"; cat $W/tree-before.txt
cp "$P/openclaw.json" $W/config-before.json
( cd "$P/state" && find . -type f \( -name "*.sqlite" -o -name "*.json" -o -name "*.jsonl" \) | sort ) > $W/state-files-before.txt
echo; echo "## published 2026.10.1: openclaw update --dry-run --tag <candidate.tgz> --yes --no-restart"
pub openclaw update --dry-run --tag "$TGZ" --yes --no-restart | red | tail -25
echo; echo "## published 2026.10.1: openclaw update --tag <candidate.tgz> --yes --no-restart"
pub openclaw update --tag "$TGZ" --yes --no-restart > $W/update.log; echo "exit=$?"; red < $W/update.log | tail -60
echo; echo "## after: installed version"; pub openclaw --version | red
echo; echo "## config after"; cfg; cp "$P/openclaw.json" $W/config-after.json
echo; echo "## pre-update config backup"; ls "$P" | grep -E "openclaw.json" | red; [ -f "$P/openclaw.json.pre-update" ] && cmp "$P/openclaw.json.pre-update" $W/config-before.json && echo "openclaw.json.pre-update is byte-identical to the config before the update"
tree "$P/workspace" > $W/tree-after-update.txt; echo; echo "## workspace after update"; diff $W/tree-before.txt $W/tree-after-update.txt && echo "WORKSPACE IDENTICAL (sha256 of every file)"
echo; echo "## openclaw update status"; pub openclaw update status | red | head -30
echo; echo "## Gateway run on the candidate, same state directory"; [ "$SHAPE" = cli ] && N=$(wc -l < "$P/stub.log")
gw candidate
if [ "$SHAPE" = cli ]; then echo; echo "## stub log, new lines from the candidate run"; tail -n +$((N+1)) "$P/stub.log" | red; echo; echo "## candidate gateway log: CLI session reuse lines"; grep -hiE "cli session|reuse=|useResume|invalidat" "$P"/gateway-candidate.log | red | head -12
  echo; echo "## operator applies the warning's key: agents.entries.main.workspace = <profile>/workspace/main (config edited directly), then one more turn"
  node -e 'const fs=require("fs");const p=process.argv[1]+"/openclaw.json";const c=JSON.parse(fs.readFileSync(p,"utf8"));c.agents.entries.main={...c.agents.entries.main,workspace:process.argv[1]+"/workspace/main"};fs.writeFileSync(p,JSON.stringify(c,null,2)+"\n")' "$P"
  N=$(wc -l < "$P/stub.log"); node --import $R/scripts/tsx.mjs $D/gw-cli.mjs --repo $R --dist $PKG --stubdir $B/cli --root "$P" --port $PORT --label pinned --turns 1 2>&1 | red
  tail -n +$((N+1)) "$P/stub.log" | red; grep -hiE "cli session|reuse=|useResume|invalidat" "$P"/gateway-pinned.log | red | head -8
fi
if false; then echo; tail -n +$((N+1)) "$P/stub.log" | red; echo; echo "## candidate gateway log: CLI session reuse lines"; grep -hiE "cli session|reuse=|useResume|invalidat" "$P"/gateway-candidate.log | red | head -12; fi
tree "$P/workspace" > $W/tree-after.txt; bad=0; while read h f; do grep -qF "$h  $f" $W/tree-after.txt || { echo "CHANGED OR MOVED: $f"; bad=1; }; done < $W/tree-before.txt; [ $bad = 0 ] && echo && echo "SEEDED AND PRE-UPDATE FILES INTACT after the candidate run ($(wc -l < $W/tree-before.txt | tr -d ' ') files)"
} > $W/updater-$SHAPE.out 2>&1
echo "finished $SHAPE"
