#!/bin/sh
# Measurement-only, applied identically to both builds: the diagnostic heartbeat (30 s) always publishes a
# memory sample (worker counts and per-script heap) instead of only after agent-lane/session-state activity.
# usage: instrument.sh <src>
W=$HOME/work/pg-r2-l3d; cd $W/src-$1/dist || exit 1
f=$(rg -l --max-depth 1 "sampleMemory\(shouldRecordMemorySample" . | head -1)
[ -n "$f" ] || { echo "not found in $1"; exit 1; }
cp $f $W/logs/instrument-$1.orig.mjs
sed -i '' 's/sampleMemory(shouldRecordMemorySample, opts)/sampleMemory(true, opts)/' $f
diff $W/logs/instrument-$1.orig.mjs $f > $W/logs/instrument-$1.diff; echo "$1 $f changed lines: $(grep -c '^>' $W/logs/instrument-$1.diff)"
