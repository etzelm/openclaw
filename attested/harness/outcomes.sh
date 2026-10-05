#!/bin/bash
# One line per tree and scenario, read from the run directories.
cd "$(dirname "$0")/runs"
echo "# turn exit codes | per turn promptChars/historyPrompt (/REFUSED = 'CLI history authority changed before execution') | per delivered user message chars:PINEAPPLE-7 count,BANANA-3 count | stored boundary after the last turn | profile requests that reached the STUB"
for s in allowed different-account revoked reassign-before-send revoke-before-send empty-first-turn-switch coverage-switch skill-config-dir skill-config-dir-persistent keychain-allowed keychain-ambiguous-prep keychain-fails-before-send keychain-fails-at-commit skill-config-dir-added record-credential-mismatch record-relabel profile-timeout profile-401 expired-unattested refresh-due rotate-after-send; do
  for t in base prev after; do
    d=$t-$s
    ex=$(grep -o "exit=[0-9]" $d/turns.log | tr '\n' ' ')
    pr=$(for e in $d/turn*.err; do c=$(grep -o "promptChars=[0-9]*" $e | head -1 | cut -d= -f2); h=$(grep -o "historyPrompt=[a-z]*" $e | head -1 | cut -d= -f2); a=$(grep -c "authority changed" $e); printf "%s/%s%s " "${c:--}" "${h:--}" "$([ $a -gt 0 ] && echo '/REFUSED')"; done)
    can=$(ls $d/fake-claude.log.user-*.txt 2>/dev/null | sort -t- -k3 -n | while read p; do printf "%s:%s,%s " $(wc -c < $p | tr -d ' ') $(grep -c PINEAPPLE-7 $p) $(grep -c BANANA-3 $p); done)
    b=$(tail -1 $d/transcript-and-boundary.txt | sed 's/cliHistoryBoundary //')
    prof=$(grep -c profile-request $d/fake-claude.log)
    echo "$s | $t | $ex| $pr| $can| $b | stubProfileRequests=$prof"
  done
done
