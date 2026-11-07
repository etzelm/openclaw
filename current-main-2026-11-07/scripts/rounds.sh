#!/bin/sh
# bench: PostgreSQL, base (current main) vs head (PR merged into the same main), interleaved
# base head head base base head head base (4 runs per build). Each run: fresh DB from template + fresh home,
# prometheus on, 20 s warmup at c4, then c1 / c8 / c16 / c32 for 45 s each, idle scrapes 10/45/100 s.
# A run starts when the 1-minute load average is below the gate (32 threads), else after 60 min of waiting.
W=$HOME/work/bench; cd $W || exit 1
GATE=${GATE:-12}
pre() { echo "$(date '+%T') $1 load=$(sysctl -n vm.loadavg) waited=${2}s $(memory_pressure -Q | tail -1)"; }
wait_load() { i=0; while [ $i -lt 360 ]; do l=$(sysctl -n vm.loadavg | awk '{print int($2)}'); [ "$l" -lt $GATE ] && return; sleep 10; i=$((i+1)); done; }
A="h1:ops_seed_pg.json:45:1 h8:ops_seed_pg.json:45:8 h16:ops_seed_pg.json:45:16 h32:ops_seed_pg.json:45:32"
for run in base-r1 head-r1 head-r2 base-r2 base-r3 head-r3 head-r4 base-r4; do
  s=${run%-r*}; t0=$(date +%s); wait_load; pre pg-$run $(( $(date +%s) - t0 )) >> logs/gates.txt
  python3 -I scripts/runL3d.py $s postgres seed_pg results/pg-$run 20 $A >> logs/rounds.log 2>&1
done
echo "ROUNDS_DONE $(date)" >> logs/rounds.log
