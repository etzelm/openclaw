#!/bin/bash
# usage: outcomes.sh <label> [scenario...]   One line per scenario, read from the run directories.
cd "$(dirname "$0")/runs"
L=$1; shift
echo "# scenario | turn exit codes | per turn promptChars/historyPrompt/useResume (REFUSED = 'CLI history authority changed before execution') | per delivered user message chars:PINEAPPLE-7,BANANA-3,MANGO-5 counts | stored boundary per session after the last turn | profile requests that reached the STUB"
for d in $( [ $# -gt 0 ] && printf "$L-%s\n" "$@" || ls -d $L-* ); do
  [ -d "$d" ] || continue
  s=${d#$L-}
  ex=$(grep -o "exit=[0-9]*" $d/turns.log | tr '\n' ' ')
  pr=$(for e in $(ls $d/turn*.err | sort -V); do c=$(grep -o "promptChars=[0-9]*" $e | head -1 | cut -d= -f2); h=$(grep -o "historyPrompt=[a-z]*" $e | head -1 | cut -d= -f2); u=$(grep -o "useResume=[a-z]*" $e | head -1 | cut -d= -f2); a=$(grep -c "authority changed" $e); printf "%s/%s/%s%s " "${c:--}" "${h:--}" "${u:--}" "$([ $a -gt 0 ] && echo '/REFUSED')"; done)
  can=$(ls $d/fake-claude.log.user-*.txt 2>/dev/null | while read p; do printf "%s %s\n" "$(stat -f %m "$p")" "$p"; done | sort -n | cut -d' ' -f2 | while read p; do printf "%s:%s,%s,%s " $(wc -c < $p | tr -d ' ') $(grep -c PINEAPPLE-7 $p) $(grep -c BANANA-3 $p) $(grep -c MANGO-5 $p); done)
  b=$(sed -E -e 's/^after turn ([0-9]+): cliHistoryBoundary /t\1:/' -e 's/^cliHistoryBoundary /+/' -e 's/"state"://; s/,"maxSeq":/\//; s/[{}"]//g' $d/boundary-by-turn.txt | tr '\n' ' ')
  prof=$(grep -c profile-request $d/fake-claude.log)
  echo "$s | $ex| $pr| $can| $b| stubProfileRequests=$prof"
done
