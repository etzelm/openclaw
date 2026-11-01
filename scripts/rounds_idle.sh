#!/bin/sh
# Long idle: one base/fix pair, c16 burst only, idle observation to 300 s after load.
W=$HOME/work/pg-r2-l3d; cd $W || exit 1
while ! grep -q ROUNDS2_DONE logs/rounds2-bg.log; do sleep 15; done
for run in base-idle-r1 fix-idle-r1; do
  s=${run%%-*}; echo "$(date '+%T') pg-$run load=$(sysctl -n vm.loadavg)"
  L3D_IDLE300=1 python3 -I scripts/runL3d.py $s postgres seed_pgc results/pg-$run 20 h16:ops_seed_pgc.json:45:16 >> logs/rounds-idle.log 2>&1
  python3 -c "import json;p='results/pg-$run/run.json';r=json.load(open(p));r['src']='$s-idle';json.dump(r,open(p,'w'),indent=1)"
done
echo "IDLE_DONE $(date)"
