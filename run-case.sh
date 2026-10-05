#!/bin/bash
# usage: run-case.sh <case> <port>; writes <case>.out with redacted results
set -u
export PATH=$HOME/homebrew/bin:$PATH
CASE=$1; PORT=$2
R=$HOME/work/165112; B=$HOME/work/165112-base; W=$HOME/work/165112-proof
P=$W/p-$CASE; PB=$W/p-$CASE-base
OUT=$W/$CASE.out
rm -rf "$P" "$PB"
red() { sed -e "s#$PB#<profile>#g" -e "s#$P#<profile>#g" -e "s#$HOME#~#g"; }
cli() { # repo profile args...
  local repo=$1 prof=$2; shift 2
  ( cd "$repo" && env -i HOME="$prof" OPENCLAW_HOME="$prof" OPENCLAW_STATE_DIR="$prof/state" OPENCLAW_CONFIG_PATH="$prof/openclaw.json" \
      OPENCLAW_NO_RESPAWN=1 NO_COLOR=1 CI=1 PATH="$PATH" TMPDIR="$prof" LANG=en_US.UTF-8 OPENAI_API_KEY=synthetic-proof-not-a-real-key \
      node dist/index.js "$@" 2>&1 )
}
files() { ( cd "$P/workspace" && for f in SOUL.md MEMORY.md memory/2026-10-01.md main/SOUL.md main/memory/2026-10-01.md dev/SOUL.md; do [ -f "$f" ] && echo "$(shasum -a 256 "$f" | cut -c1-16)  $f"; done ); }
mainws() { node -e 'const c=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));console.log("agents.entries.main =",JSON.stringify(c.agents.entries.main),"| agents.entries.dev =",JSON.stringify(c.agents.entries.dev))' "$1/openclaw.json" | red; }
{
echo "# case: $CASE"
node --import $R/scripts/tsx.mjs $W/setup-profile.mjs --repo $R --root "$P" --port $PORT --case $CASE
echo; echo "## user files before (sha256 prefix)"; files
echo; node --import $R/scripts/tsx.mjs $W/gw-turns.mjs --repo $R --root "$P" --port $PORT --label before 2>&1 | red
cp "$P/openclaw.json" "$W/$CASE-config-before.json"
echo; echo "## base build (upstream main 66bd35b4e5f2): openclaw doctor --fix --non-interactive"
cp -a "$P" "$PB"
cli $B "$PB" doctor --fix --non-interactive > "$W/$CASE-doctor-base.log"; echo "exit=$?"
grep -iE "workspace|agents\.entries\.main" "$W/$CASE-doctor-base.log" | red | head -20
mainws "$PB"
echo; echo "## patched build: openclaw doctor (no --fix)"
cli $R "$P" doctor --non-interactive > "$W/$CASE-doctor-preview.log"; echo "exit=$?"
grep -iE -A3 "agents\.entries\.main|has workspace files|system agent" "$W/$CASE-doctor-preview.log" | red | head -24
mainws "$P"
echo; echo "## patched build: openclaw doctor --fix --non-interactive"
cli $R "$P" doctor --fix --non-interactive > "$W/$CASE-doctor-fix.log"; echo "exit=$?"
grep -iE -A3 "agents\.entries\.main|has workspace files|system agent" "$W/$CASE-doctor-fix.log" | red | head -24
mainws "$P"
cp "$P/openclaw.json" "$W/$CASE-config-after.json"
echo; echo "## patched build: openclaw agents list --json (main, dev workspace)"
cli $R "$P" agents list --json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s.slice(s.indexOf("[")));for(const a of j)console.log(a.id,"->",a.workspace)}catch(e){console.log("unparsed:",s.slice(0,400))}})' | red
echo; node --import $R/scripts/tsx.mjs $W/gw-turns.mjs --repo $R --root "$P" --port $PORT --label after 2>&1 | red
echo; echo "## user files after (sha256 prefix)"; files
} > "$OUT" 2>&1
echo "done $CASE"
