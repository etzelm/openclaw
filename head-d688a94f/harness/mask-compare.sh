#!/bin/bash
# Compare harness outcomes with the turn-2 client exit code of interrupted-* rows masked (1 vs 143 race) and the outcomes script's sed stderr line dropped.
L=~/work/pr-164796-h/logs; R=~/work/pr-164796-h/ref
n() { sed -E 's/^(interrupted-[a-z-]+ \| exit=[0-9]+ )exit=(1|143) /\1exit=RACE /' "$1" | grep -v "^sed: "; }
n $R/outcomes-after.txt > /tmp/oc-r15.$$; n $R/outcomes-after.prevmerge.txt > /tmp/oc-prev.$$; n $L/outcomes-after.final.txt > /tmp/oc-new.$$
diff /tmp/oc-r15.$$ /tmp/oc-new.$$ > /dev/null && echo "vs r15 (13078e36c7e): identical after masking ($(wc -l < /tmp/oc-new.$$) lines)" || { echo "vs r15 DIFFERS"; diff /tmp/oc-r15.$$ /tmp/oc-new.$$ | head; }
diff /tmp/oc-prev.$$ /tmp/oc-new.$$ > /dev/null && echo "vs previous merged head 79a4c3bb3bc: identical after masking" || { echo "vs prev DIFFERS"; diff /tmp/oc-prev.$$ /tmp/oc-new.$$ | head; }
rm -f /tmp/oc-*.$$
