#!/bin/sh
# L3d bench: 3 interleaved PostgreSQL runs per build (ABBAAB), then one SQLite run per build.
# Each run: fresh DB from template + fresh home (arm_reset.sh via runL3d.py), prometheus on, 20 s warmup at c4,
# then h1 (c1 45 s), h8 (c8 45 s), h16 (c16 45 s), idle scrapes at 10/45/100 s.
W=$HOME/work/pg-r2-l3d; cd $W || exit 1
pre() { echo "$(date '+%T') $1 load=$(sysctl -n vm.loadavg) $(memory_pressure -Q | tail -1)"; }
wait_load() { i=0; while [ $i -lt 30 ]; do l=$(sysctl -n vm.loadavg | awk '{print int($2)}'); [ "$l" -lt 12 ] && return; sleep 10; i=$((i+1)); done; }
A="h1:ops_seed_pgc.json:45:1 h8:ops_seed_pgc.json:45:8 h16:ops_seed_pgc.json:45:16"
for run in base-r1 fix-r1 fix-r2 base-r2 base-r3 fix-r3; do
  s=${run%-r*}; wait_load; pre $run
  python3 -I scripts/runL3d.py $s postgres seed_pgc results/pg-$run 20 $A >> logs/rounds.log 2>&1
done
B="h1:ops_seed_sqlite.json:45:1 h8:ops_seed_sqlite.json:45:8 h16:ops_seed_sqlite.json:45:16"
for run in base-r1 fix-r1; do
  s=${run%-r*}; wait_load; pre sqlite-$run
  python3 -I scripts/runL3d.py $s sqlite seed_sqlite results/sqlite-$run 20 $B >> logs/rounds.log 2>&1
done
echo "ROUNDS_DONE $(date)"
