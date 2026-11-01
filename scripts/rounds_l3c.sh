#!/bin/sh
# L3c bench: statement traces, then 3 interleaved rounds per build (ABBAAB).
# Each run: fresh DB from template seed_a + fresh home (arm_reset.sh via runL3.py), prometheus on,
# 20 s chat.history warmup, then h1 (c1 45 s), h8 (c8 45 s), d1 (dev-agent sessions only, c1 20 s).
W=$HOME/work/pg-r2-l3c; cd $W || exit 1
pre() { echo "$(date '+%T') $1 load=$(sysctl -n vm.loadavg) $(memory_pressure -Q | tail -1)"; }
wait_load() { i=0; while [ $i -lt 30 ]; do l=$(sysctl -n vm.loadavg | awk '{print int($2)}'); [ "$l" -lt 30 ] && return; sleep 10; i=$((i+1)); done; }
export L3C_WARM_OPS=ops_hist.json
for s in live livefix; do pre trace-$s; L3C_TRACE=3 python3 -I scripts/runL3.py $s results/trace-$s 20 >> logs/rounds.log 2>&1; done
for run in live-r1 livefix-r1 livefix-r2 live-r2 live-r3 livefix-r3; do
  s=${run%-r*}; wait_load; pre $run
  python3 -I scripts/runL3.py $s results/$run 20 h1:ops_hist.json:45:1 h8:ops_hist.json:45:8 d1:ops_hist_dev.json:20:1 >> logs/rounds.log 2>&1
done
echo "ROUNDS_DONE $(date)"
