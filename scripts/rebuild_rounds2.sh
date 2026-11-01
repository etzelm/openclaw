#!/bin/sh
# Cap 4: rebuild the fix from fix-v3.diff, instrument both dists identically, then interleaved PG rounds (ABBAAB)
# and two SQLite runs per build, then final checks on the fix tree.
export LC_ALL=en_US.UTF-8 LANG=en_US.UTF-8 CI=1 npm_config_update_notifier=false
W=$HOME/work/pg-r2-l3d; cd $W || exit 1
rm -rf src-fix4
git -C repo worktree move src-fix src-fix8 2>/dev/null || mv src-fix src-fix8
git -C repo worktree add -q --detach $W/src-fix 31866655fd6 && cd $W/src-fix && git apply ~/nas/outputs/pg-round2/L3d/patch/fix-v3.diff && echo "v3 applied"
pnpm install --frozen-lockfile --prefer-offline > $W/logs/build-fix-v3.log 2>&1; echo "install rc=$?"
pnpm build >> $W/logs/build-fix-v3.log 2>&1; echo "build rc=$? $(date)"
cd $W && sh scripts/instrument.sh fix && grep -c "POSTGRES_SESSION_HISTORY_WORKERS = 4" $(cd src-fix/dist && rg -l --max-depth 1 "POSTGRES_SESSION_HISTORY_WORKERS" . | sed "s#^#src-fix/dist/#")
pre() { echo "$(date '+%T') $1 load=$(sysctl -n vm.loadavg) $(memory_pressure -Q | tail -1)"; }
wait_load() { i=0; while [ $i -lt 60 ]; do l=$(sysctl -n vm.loadavg | awk '{print int($2)}'); [ "$l" -lt 9 ] && return; sleep 10; i=$((i+1)); done; }
A="h1:ops_seed_pgc.json:45:1 h8:ops_seed_pgc.json:45:8 h16:ops_seed_pgc.json:45:16"
for run in base-r4 fix-r4 fix-r5 base-r5 base-r6 fix-r6; do
  s=${run%-r*}; wait_load; pre pg-$run
  python3 -I scripts/runL3d.py $s postgres seed_pgc results/pg-$run 20 $A >> logs/rounds2.log 2>&1
done
B="h1:ops_seed_sqlite.json:45:1 h8:ops_seed_sqlite.json:45:8 h16:ops_seed_sqlite.json:45:16"
for run in fix-r2 base-r2; do
  s=${run%-r*}; wait_load; pre sqlite-$run
  python3 -I scripts/runL3d.py $s sqlite seed_sqlite results/sqlite-$run 20 $B >> logs/rounds2.log 2>&1
done
echo "ROUNDS2_DONE $(date)"
