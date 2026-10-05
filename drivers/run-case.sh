#!/bin/bash
# usage: run-case.sh <case> <port> ; cases: root subdir neither both agentsmd env tilde include

export PATH=$HOME/homebrew/bin:$PATH
CASE=$1; PORT=$2
R=${R:-$HOME/work/pr165112r2/src}; W=$HOME/work/pr165112r2/proof
P=$W/p-$CASE; OUT=$W/$CASE.out
rm -rf "$P"
ENVVARS=()
case $CASE in env|include) ENVVARS=(WORKSPACE_ROOT="$P/workspace");; esac
red() { sed -e "s#$P#<profile>#g" -e "s#$HOME#~#g"; }
cli() { ( cd "$R" && env -i HOME="$P" OPENCLAW_HOME="$P" OPENCLAW_STATE_DIR="$P/state" OPENCLAW_CONFIG_PATH="$P/openclaw.json" \
      OPENCLAW_NO_RESPAWN=1 NO_COLOR=1 CI=1 PATH="$PATH" TMPDIR="$P" LANG=en_US.UTF-8 OPENAI_API_KEY=synthetic-proof-not-a-real-key "${ENVVARS[@]}" \
      node dist/index.js "$@" 2>&1 ); }
tree() { ( cd "$1" && find . -type f | sort | while read f; do echo "$(shasum -a 256 "$f" | cut -c1-16)  $f"; done ); }
agents() { cli agents list --json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s.slice(s.indexOf("[")));for(const a of j)console.log(a.id,"->",a.workspace)}catch(e){console.log("unparsed:",s.slice(0,400))}})' | red; }
gw() { local label=$1; shift; node --import $R/scripts/tsx.mjs $W/gw-turns.mjs --repo $R --root "$P" --port $PORT --label $label "$@" 2>&1 | red; }
GWENV=(); for e in "${ENVVARS[@]}"; do GWENV+=(--env "$e"); done
{
echo "# case: $CASE (head $(cd $R && git rev-parse --short=11 HEAD))"
node --import $R/scripts/tsx.mjs $W/setup-profile.mjs --repo $R --root "$P" --port $PORT --case $CASE
echo; echo "## workspace files before (sha256 prefix)"; tree "$P/workspace" | tee "$W/$CASE-tree-before.txt"
echo; echo "## config before: agents.defaults.workspace / defaults include / entries"
node -e 'const fs=require("fs");const p=process.argv[1];const c=JSON.parse(fs.readFileSync(p+"/openclaw.json","utf8"));console.log("openclaw.json agents.defaults =",JSON.stringify(c.agents.defaults&&c.agents.defaults.$include?c.agents.defaults:{workspace:c.agents.defaults.workspace}));if(fs.existsSync(p+"/defaults.json5"))console.log("defaults.json5 workspace =",JSON.parse(fs.readFileSync(p+"/defaults.json5","utf8")).workspace);console.log("agents.entries =",JSON.stringify(c.agents.entries))' "$P" | red
cp "$P/openclaw.json" "$W/$CASE-config-before.json"
echo; echo "## agents list (before)"; agents
echo; gw before "${GWENV[@]}"
tree "$P/workspace" > "$W/$CASE-tree-predoctor.txt"
echo; echo "## openclaw doctor --non-interactive"
cli doctor --non-interactive > "$W/$CASE-doctor-preview.log"; echo "exit=$?"
red < "$W/$CASE-doctor-preview.log" | grep -iE -B1 -A4 "agents\.entries\.main|has workspace files|system agent|workspace" | head -40
echo; echo "## openclaw doctor --fix --non-interactive"
cli doctor --fix --non-interactive > "$W/$CASE-doctor-fix.log"; echo "exit=$?"
red < "$W/$CASE-doctor-fix.log" | grep -iE -B1 -A4 "agents\.entries\.main|has workspace files|system agent|workspace" | head -40
tree "$P/workspace" > "$W/$CASE-tree-postdoctor.txt"
diff -q "$W/$CASE-tree-predoctor.txt" "$W/$CASE-tree-postdoctor.txt" >/dev/null && echo && echo "DOCTOR TREE IDENTICAL: sha256 of every file under the workspace is the same before and after doctor + doctor --fix ($(wc -l < $W/$CASE-tree-postdoctor.txt | tr -d ' ') files)" || { echo "DOCTOR TREE DIFFERS:"; diff "$W/$CASE-tree-predoctor.txt" "$W/$CASE-tree-postdoctor.txt"; }
echo; echo "## config after"
node -e 'const fs=require("fs");const p=process.argv[1];const c=JSON.parse(fs.readFileSync(p+"/openclaw.json","utf8"));console.log("openclaw.json agents.defaults =",JSON.stringify(c.agents.defaults&&c.agents.defaults.$include?c.agents.defaults:{workspace:c.agents.defaults.workspace}));console.log("agents.entries =",JSON.stringify(c.agents.entries))' "$P" | red
[ -f "$P/defaults.json5" ] && { echo "defaults.json5 sha256 $(shasum -a 256 $P/defaults.json5 | cut -c1-16)"; }
cp "$P/openclaw.json" "$W/$CASE-config-after.json"
echo; echo "## agents list (after)"; agents
echo; gw after "${GWENV[@]}"
echo; echo "## workspace files after gateway (sha256 prefix)"; tree "$P/workspace" > "$W/$CASE-tree-after.txt"; cat "$W/$CASE-tree-after.txt"
bad=0; while read h f; do grep -qF "$h  $f" "$W/$CASE-tree-after.txt" || { echo "CHANGED OR MOVED: $f"; bad=1; }; done < "$W/$CASE-tree-before.txt"
[ $bad = 0 ] && echo "SEEDED FILES INTACT: every seeded user file ($(wc -l < $W/$CASE-tree-before.txt | tr -d ' ')) is still at its path with the same sha256; extra files in the listing above were created by Gateway startup template seeding, not by Doctor"
if [ "$CASE" = env ] || [ "$CASE" = include ]; then
  mkdir -p "$P/moved/main" "$P/moved/dev"
  echo "PROOF-MARKER-MOVED-SOUL: persona in the relocated workspace root." > "$P/moved/main/SOUL.md"
  echo "moved dev" > "$P/moved/dev/SOUL.md"
  ENVVARS=(WORKSPACE_ROOT="$P/moved"); GWENV=(--env "WORKSPACE_ROOT=$P/moved")
  echo; echo "## WORKSPACE_ROOT changed to <profile>/moved (config untouched)"; agents
  echo; gw moved "${GWENV[@]}"
fi
} > "$OUT" 2>&1
echo "done $CASE"
