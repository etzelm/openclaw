#!/bin/bash
R=$HOME/nas/outputs/pr-simplify/164796/merge4/harness; N=$HOME/work/m5-harness/out
mask(){ sed -E 's/^(interrupted-[a-z-]+ \| exit=0 exit=)[0-9]+/\1RACE/'; }
echo "# outcomes-after.txt at merge5 af1d1ce4a2a (tree 76779f6d8d2) vs merge4 a0d666e123c (tree 20792bab1d8). Reference = '<', this run = '>'."
echo "# Mask: turn-2 client exit code of interrupted-* rows (1 vs 143 race)."
echo "lines: ref=$(wc -l < $R/outcomes-after.txt | tr -d ' ') new=$(wc -l < $N/outcomes-after.txt | tr -d ' ')"
if diff <(mask < $R/outcomes-after.txt) <(mask < $N/outcomes-after.txt); then echo "IDENTICAL after exit-race mask"; else echo "DIFFERS after exit-race mask (above)"; fi
echo "# unmasked diff:"
diff $R/outcomes-after.txt $N/outcomes-after.txt && echo "(byte-identical unmasked)"
echo "# outcomes-upgrade-1005.txt:"
diff $R/outcomes-upgrade-1005.txt $N/outcomes-upgrade-1005.txt && echo "IDENTICAL"
