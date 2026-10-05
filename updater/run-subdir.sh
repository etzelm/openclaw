#!/bin/bash
export PATH=$HOME/homebrew/bin:$PATH
B=$HOME/work/pr165112r2; R=$B/src; P=$B/upd/profile; G=$B/gprefix; TGZ=$B/pack/openclaw-candidate.tgz
rm -rf "$P"
red() { sed -e "s#$P#<profile>#g" -e "s#$B#<work>#g" -e "s#$HOME#~#g"; }
pub() { env -i HOME="$P" OPENCLAW_HOME="$P" OPENCLAW_STATE_DIR="$P/state" OPENCLAW_CONFIG_PATH="$P/openclaw.json" NPM_CONFIG_PREFIX="$G" npm_config_cache="$B/upd/npm-cache" OPENCLAW_NO_RESPAWN=1 NO_COLOR=1 CI=1 PATH="$G/bin:$PATH" TMPDIR="$P" LANG=en_US.UTF-8 OPENAI_API_KEY=synthetic-proof-not-a-real-key "$@" 2>&1; }
tree() { ( cd "$1" && find . -type f -not -path "./.git/*" | sort | while read f; do echo "$(shasum -a 256 "$f" | cut -c1-16)  $f"; done ); }
node --import $R/scripts/tsx.mjs $B/proof/setup-profile.mjs --repo $R --root "$P" --port 20400 --case subdir > $B/upd/setup.log 2>&1
{
cat $B/upd/setup.log
echo "## installed updater"; pub openclaw --version | red; pub npm ls -g --depth=0 | red
echo; echo "## candidate artifact"; ls -la "$TGZ" | red; tar -xzOf "$TGZ" package/package.json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);console.log(j.name,j.version,"updateAdmissionProtocol=",j.openclaw&&j.openclaw.updateAdmissionProtocol)})'
tree "$P/workspace" > $B/upd/tree-before.txt; echo; echo "## workspace before"; cat $B/upd/tree-before.txt
cp "$P/openclaw.json" $B/upd/config-before.json
echo; echo "## config before"; node -e 'const c=require(process.argv[1]);console.log("agents.defaults.workspace =",c.agents.defaults.workspace,"| entries =",JSON.stringify(c.agents.entries))' "$P/openclaw.json" | red
echo; echo "## published 2026.9.8: openclaw update --dry-run --tag <candidate.tgz> --yes --no-restart"
pub openclaw update --dry-run --tag "$TGZ" --yes --no-restart | red | tail -40
echo; echo "## published 2026.9.8: openclaw update --tag <candidate.tgz> --yes --no-restart"
pub openclaw update --tag "$TGZ" --yes --no-restart > $B/upd/update.log; echo "exit=$?"; red < $B/upd/update.log | tail -80
echo; echo "## after: installed version"; pub openclaw --version | red; pub npm ls -g --depth=0 | red
echo; echo "## config after"; node -e 'const c=require(process.argv[1]);console.log("agents.defaults.workspace =",c.agents.defaults.workspace,"| entries =",JSON.stringify(c.agents.entries))' "$P/openclaw.json" | red
cp "$P/openclaw.json" $B/upd/config-after.json; ls "$P" | red
tree "$P/workspace" > $B/upd/tree-after.txt; echo; echo "## workspace after"; diff $B/upd/tree-before.txt $B/upd/tree-after.txt && echo "WORKSPACE IDENTICAL (sha256)"
echo; echo "## update status"; pub openclaw update status | red | head -30
} > $B/upd/updater.out 2>&1
echo finished
