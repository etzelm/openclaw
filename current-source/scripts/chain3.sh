#!/bin/sh
# Sparse limit-2 rounds with a 20 s closed-loop latency run each, 5 per arm, interleaved ABBA.
W=$HOME/work/pc-190001; cd $W || exit 1
n=0
for a in base fix fix base base fix fix base base fix; do n=$((n+1)); SPARSE=1 LOAD_S=20 python3 -I scripts/run.py trace $a sparse-$a-L$n; done
echo CHAIN3_DONE
