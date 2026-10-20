#!/bin/bash
# usage: record3.sh <label> <run dir>   One record: turn log, cli lines, child records (path fields omitted), canaries, stored boundary.
L=$1; d=$2
echo "######## $L"
grep -E '^turn|^gateway' $d/turns.log
for e in $(ls $d/turn*.err | sort -V); do n=$(basename $e .err); echo "[$n log]"; grep -hE 'cli exec|terminal failure|lane task error|connection closed' $e | sed -E 's/^\[[^]]*\] //' | cut -c1-400; done
echo "[fake claude child records, turn 3 onward; configDir and file-path fields omitted]"
p3=$(ls $d/fake-claude.log.user-*.txt | while read p; do printf "%s %s\n" "$(stat -f %m "$p")" "$p"; done | sort -n | sed -n 2p | sed -E 's/.*user-([0-9]+)-.*/\1/')
python3 ~/work/pr-164796-logs/child3.py $d/fake-claude.log $p3
echo "[canaries per delivered user message and its UserPromptSubmit context, bytes]"
for u in $(ls $d/fake-claude.log.user-*.txt | while read p; do printf "%s %s\n" "$(stat -f %m "$p")" "$p"; done | sort -n | cut -d' ' -f2); do c=${u/.user-/.context-}; echo "$(basename $u | sed 's/fake-claude.log.//'): bytes=$(wc -c < $u | tr -d ' ') PINEAPPLE-7=$(grep -c PINEAPPLE-7 $u) MANGO-5=$(grep -c MANGO-5 $u) | context bytes=$(wc -c < $c | tr -d ' ') MANGO-5=$(grep -c MANGO-5 $c) interrupted-section=$(grep -c 'Interrupted inputs' $c)"; done
echo "[session_pending_inputs after the last turn]"
node ~/work/pr-164796-logs/pending3.mjs $d/state/agents/main/agent/openclaw-agent.sqlite
echo "[stored boundary after each turn]"
cat $d/boundary-by-turn.txt
