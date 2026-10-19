#!/bin/bash
d=$1; V=$2
echo "######## after / upgrade from v$V"
echo "[released install] $(node -p "require('$HOME/work/pr-164796-h/release-1005/node_modules/openclaw/package.json').version")"
grep -E '^turn [0-9]+ exit|^doctor' $d/turns.log
for e in $(ls $d/turn*.err | sort -V); do n=$(basename $e .err); echo "[$n openclaw log]"; grep -hE 'cli exec|refused across|terminal failure' $e | sed -E 's/^\[[^]]*\] //' | cut -c1-400; done
echo "[prompt canaries per user message, and its UserPromptSubmit context]"
for u in $(ls $d/fake-claude.log.user-*.txt | while read p; do printf "%s %s\n" "$(stat -f %m "$p")" "$p"; done | sort -n | cut -d' ' -f2); do c=${u/.user-/.context-}; echo "$(basename $u | sed 's/fake-claude.log.//'): chars=$(wc -c < $u | tr -d ' ') PINEAPPLE-7=$(grep -c PINEAPPLE-7 $u) MANGO-5=$(grep -c MANGO-5 $u) | context bytes=$(wc -c < $c | tr -d ' ')"; done
echo "[stored boundary after each turn]"; cat $d/boundary-by-turn.txt
echo "[transcript rows before the upgrade (written by $V)]"; cat $d/transcript-before-upgrade.txt
echo "[transcript rows and boundaries after turn 5]"; cat $d/transcript-and-boundary.txt
echo "[agents.defaults.workspace before and after]"
for f in before after; do echo "$f: $(node -p "require('$d/config-$f-upgrade.json').agents?.defaults?.workspace" | sed "s#$HOME#\$HOME#")"; done
