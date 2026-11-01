#!/bin/sh
W=$HOME/work/pg-r2-l3d; cd $W || exit 1
while ! grep -q CAP4_DONE logs/cap4-bg.log; do sleep 10; done
i=0; while [ $i -lt 60 ]; do l=$(sysctl -n vm.loadavg | awk '{print int($3)}'); [ "$l" -lt 9 ] && break; sleep 10; i=$((i+1)); done
echo "$(date '+%T') fix4-r3 load=$(sysctl -n vm.loadavg)"
python3 -I scripts/runL3d.py fix4 postgres seed_pgc results/pg-fix4-r3 20 h1:ops_seed_pgc.json:45:1 h8:ops_seed_pgc.json:45:8 h16:ops_seed_pgc.json:45:16 >> logs/rounds.log 2>&1
echo "CAP4B_DONE $(date)"
