#!/bin/bash
# usage: outcomes2.sh <label> [scenario...]  Same columns as outcomes.sh, except the per-turn column,
# which main's logging cleanup (447128e3a84 removed the `cli exec:` line) now derives from the synthetic
# child's own records: delivered user message chars / spawn sessionMode (fresh|resume) / REFUSED when the
# turn failed with 'CLI history authority changed before execution' (turnN.err or turnN.out).
cd "$(dirname "$0")/runs"
L=$1; shift
echo "# scenario | turn exit codes | per turn: delivered user message chars/child spawn sessionMode (fresh|resume) (the spawn record of the child that received that message; REFUSED = 'CLI history authority changed before execution'; -/- = no user message reached a child) | per delivered user message chars:PINEAPPLE-7,BANANA-3,MANGO-5 counts, then +ctx with the same counts for the UserPromptSubmit context the child received | stored boundary per session after the last turn | profile requests that reached the STUB"
for d in $( [ $# -gt 0 ] && printf "$L-%s\n" "$@" || ls -d $L-* ); do
  [ -d "$d" ] || continue
  s=${d#$L-}
  ex=$(grep -o "exit=[0-9]*" $d/turns.log | tr '\n' ' ')
  pr=$(for e in $(ls $d/turn*.err | sort -V); do n=$(basename $e .err | sed 's/turn//'); 
      sec=$(awk -v n="$n" '/^=== turn/{on=($0 ~ "^=== turn"n"[ (]")} on' $d/fake-claude.log)
      um=$(echo "$sec" | grep '"event":"user-message-received"' | head -1)
      c=$(echo "$um" | grep -o '"chars":[0-9]*' | cut -d: -f2)
      pid=$(echo "$um" | grep -o '"pid":[0-9]*' | cut -d: -f2)
      m=$([ -n "$pid" ] && echo "$sec" | grep '"event":"spawn"' | grep "\"pid\":$pid," | grep -o '"sessionMode":"[a-z]*"' | cut -d'"' -f4)
      a=$(cat $e $d/turn$n.out 2>/dev/null | grep -c "authority changed")
      printf "%s/%s%s " "${c:--}" "${m:--}" "$([ $a -gt 0 ] && echo '/REFUSED')"; done)
  can=$(ls $d/fake-claude.log.user-*.txt 2>/dev/null | while read p; do printf "%s %s\n" "$(stat -f %m "$p")" "$p"; done | sort -n | cut -d' ' -f2 | while read p; do c=${p/.user-/.context-}; printf "%s:%s,%s,%s" $(wc -c < $p | tr -d ' ') $(grep -c PINEAPPLE-7 $p) $(grep -c BANANA-3 $p) $(grep -c MANGO-5 $p); [ -f "$c" ] && printf "+ctx%s:%s,%s,%s" $(wc -c < $c | tr -d ' ') $(grep -c PINEAPPLE-7 $c) $(grep -c BANANA-3 $c) $(grep -c MANGO-5 $c); printf " "; done)
  b=$(sed -E -e 's/^after turn ([0-9]+): cliHistoryBoundary /t\1:/' -e 's/^cliHistoryBoundary /+/' -e 's/"state"://; s/,"maxSeq":/\//; s/[{}"]//g' $d/boundary-by-turn.txt | tr '\n' ' ')
  prof=$(grep -c profile-request $d/fake-claude.log)
  echo "$s | $ex| $pr| $can| $b| stubProfileRequests=$prof"
done
