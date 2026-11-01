#!/bin/sh
# usage: diag_run.sh <src> : boot with the diagnostics timeline, 4 sequential chat.history calls, stop.
W=$HOME/work/pg-r2-l3c; S=$1; OUT=$W/results/diag-$S; rm -rf $OUT; mkdir -p $OUT
sh $W/scripts/arm_reset.sh seed_a diag-$S $S > $OUT/reset.log 2>&1
H=$W/inst/diag-$S/home; export L3C_TIMELINE=$OUT/timeline.jsonl
$W/scripts/oc_diag.sh $S $H gateway run --port 19361 --bind loopback --auth none --tailscale off > $OUT/gateway.log 2>&1 &
pid=$!; i=0; while [ $i -lt 120 ]; do sleep 1; i=$((i+1)); grep -q '\[gateway\] ready' $OUT/gateway.log && break; done
WS=$W/src-$S/node_modules/ws/index.js
for k in agent:<id>:<session> agent:<id>:<session>; do
  for n in 1 2; do date +%s.%N >> $OUT/marks.txt; node $W/scripts/driver.mjs $WS 19361 call chat.history "{\"sessionKey\":\"$k\",\"limit\":100}" 100000000 > /dev/null; date +%s.%N >> $OUT/marks.txt; sleep 1; done
done
kill $pid; sleep 3; kill -9 $pid 2>/dev/null; wc -l $OUT/timeline.jsonl
