#!/bin/sh
# Cap check: the fix build with the PostgreSQL history cap set to 4 instead of 8 (dist constant only,
# APFS clone of the fix build), 2 runs, same arms as rounds.sh. Waits for rounds.sh to finish.
W=$HOME/work/pg-r2-l3d; cd $W || exit 1
while ! grep -q ROUNDS_DONE logs/rounds-bg.log; do sleep 15; done
rm -rf src-fix4 && cp -Rc src-fix src-fix4 && cd src-fix4/dist && f=$(rg -l --max-depth 1 "POSTGRES_SESSION_HISTORY_WORKERS = 8" .) && \
  sed -i '' 's/POSTGRES_SESSION_HISTORY_WORKERS = 8/POSTGRES_SESSION_HISTORY_WORKERS = 4/' $f && echo "cap4 $f: $(grep -c 'POSTGRES_SESSION_HISTORY_WORKERS = 4' $f)"
cd $W
pre() { echo "$(date '+%T') $1 load=$(sysctl -n vm.loadavg) $(memory_pressure -Q | tail -1)"; }
A="h1:ops_seed_pgc.json:45:1 h8:ops_seed_pgc.json:45:8 h16:ops_seed_pgc.json:45:16"
for run in fix4-r1 fix4-r2; do
  s=${run%-r*}; pre $run
  python3 -I scripts/runL3d.py $s postgres seed_pgc results/pg-$run 20 $A >> logs/rounds.log 2>&1
done
echo "CAP4_DONE $(date)"
