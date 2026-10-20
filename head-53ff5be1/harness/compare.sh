#!/bin/bash
R=$HOME/nas/outputs/pr-simplify/164796/round3/evidence/head-8d822e26/harness; N=$HOME/work/m4-harness/out
mask(){ sed -E 's/^(interrupted-[a-z-]+ \| exit=0 exit=)[0-9]+/\1RACE/'; }
echo "# outcomes-after.txt at merge a0d666e123c (tree 20792bab1d8) vs round3 head-8d822e26 (8d822e2632d). Reference = '<', this run = '>'."
echo "# Mask: turn-2 client exit code of interrupted-* rows (1 vs 143 race)."
echo "lines: ref=$(wc -l < $R/outcomes-after.txt | tr -d ' ') new=$(wc -l < $N/outcomes-after.txt | tr -d ' ')"
if diff <(mask < $R/outcomes-after.txt) <(mask < $N/outcomes-after.txt); then echo "IDENTICAL after exit-race mask"; else echo "DIFFERS after exit-race mask (above)"; fi
echo "# unmasked diff:"
diff $R/outcomes-after.txt $N/outcomes-after.txt && echo "(byte-identical unmasked)"
echo "# outcomes-upgrade-1005.txt:"
diff $R/outcomes-upgrade-1005.txt $N/outcomes-upgrade-1005.txt && echo "IDENTICAL"
