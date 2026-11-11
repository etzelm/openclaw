#!/bin/sh
# usage: profrun.sh <tag> <src...>
# One CPU-profiled bench run per listed src (in order): fresh DB + home, 20 s warmup at 4 clients, 45 s at 8 clients.
# --cpu-prof via NODE_OPTIONS reaches every worker thread; profiles land in prof/<tag>-<src>-<n>/.
W=$BENCH_DIR; cd $W || exit 1
export TMPDIR=$BENCH_TMP; mkdir -p $TMPDIR
TAG=$1; shift; n=0
for s in "$@"; do
  n=$((n+1)); P=$W/prof/$TAG-$s-$n; mkdir -p $P
  echo "$(date '+%T') $TAG-$s-$n load=$(sysctl -n vm.loadavg)" >> logs/prof.txt
  L3_NODE_OPTIONS="--cpu-prof --cpu-prof-dir=$P" python3 -I scripts/runL3d.py $s postgres seed_pg results/$TAG-$s-$n 20 h8:ops_seed_pg.json:45:8 >> logs/prof.log 2>&1
done
echo "PROF_DONE $TAG $(date)" >> logs/prof.log
