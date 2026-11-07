#!/bin/sh
# Sparse limit-2 traces (base, fix, fix, base), then a reverse-order default round (fix, base).
W=$HOME/work/pc-190001; cd $W || exit 1
for t in base:s1 fix:s1 fix:s2 base:s2; do a=${t%%:*}; r=${t#*:}; SPARSE=1 python3 -I scripts/run.py trace $a sparse-$a-$r; done
for a in fix base; do python3 -I scripts/run.py trace $a $a-r3; done
echo CHAIN2_DONE
