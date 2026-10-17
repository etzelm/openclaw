#!/bin/zsh
# Two rounds; within each round and store the arms run back to back, in the order
# BEFORE, AFTER in round 1 and AFTER, BEFORE in round 2. Each arm waits for a quiet
# box (1-minute load average below 4) and logs the load it started at.
cd ~/work/t2-02-evidence-measure
quiet() { local n=0; while (( $(sysctl -n vm.loadavg | awk '{print $2}') >= 4.0 )); do sleep 30; (( n++ > 480 )) && break; done; echo "$(date +%T) $1 start load $(sysctl -n vm.loadavg) mem $(memory_pressure -Q | tail -1 | awk '{print $NF}')" >> $HOME/work/t2-02-evidence-commit/run-commit.load; }
for round in 1 2; do
  [ $round = 1 ] && arms=(BEFORE AFTER) || arms=(AFTER BEFORE)
  for store in A B; do
    if [ $store = A ]; then label="agent store A (430,518,272 bytes)"; modes=keyword,semantic; else label="agent store B (4,855,853,056 bytes)"; modes=keyword; fi
    out=$HOME/work/t2-02-evidence-commit/measure-delta-$store-round$round.out; : > $out
    for arm in $arms; do
      wt=~/work/t2-02-memory-delta-${arm:l}
      quiet "round$round $store $arm"
      (cd $wt && node --import ./scripts/tsx.mjs ~/work/t2-02-evidence-measure/measure-delta.mjs --root $wt --arm $arm --round $round --store ~/work/t2-02-db/store$store.sqlite --store-label "$label" --sizes medium,large --modes $modes --runs 5 --warmups 2 >> $out 2>&1)
    done
  done
done
echo ALLDONE > ../t2-02-evidence-commit/run-commit.done
