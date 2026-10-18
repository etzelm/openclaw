#!/bin/bash
# usage: measure-rebased.sh <base-dir> <after-dir> <run-root>
# The print-once change rebased onto a newer base: observed runs on three cells, then observer-off timing in
# two rounds with one warmup per arm and runs alternating arm by arm (round 1 base first, round 2 after first):
# W3/dev 5 runs per arm, W2/none 3 runs per arm; then one W3/main run per arm.
set -u
BASE=$1; AFTER=$2; ROOT=$3; T=$(cd "$(dirname "$0")" && pwd); mkdir -p "$ROOT"; L=$ROOT/measure.log
one() { echo "$(date +%T) start $1 $3 $4 $5 load: $(sysctl -n vm.loadavg)" >> "$L"
  "$T/run-arm.sh" "$2" "$1" "$3" "$4" "$ROOT" "$5" > "$ROOT/$1-$3-$4-$5.log" 2>&1
  echo "$(date +%T) end $1 $3 $4 $5 exit=$?" >> "$L"; }
for c in "W3 dev" "W2 none" "W3 main"; do set -- $c; one base "$BASE" $1 $2 obs; one after "$AFTER" $1 $2 obs; done
export T203_OBSERVE=0
cell() { local r=$1 W=$2 S=$3 n=$4; one $5 "$6" $W $S r$r-warm; one $7 "$8" $W $S r$r-warm
  for i in $(seq "$n"); do one $5 "$6" $W $S r$r-$i; one $7 "$8" $W $S r$r-$i; done; }
cell 1 W3 dev 5 base "$BASE" after "$AFTER"; cell 1 W2 none 3 base "$BASE" after "$AFTER"
cell 2 W3 dev 5 after "$AFTER" base "$BASE"; cell 2 W2 none 3 after "$AFTER" base "$BASE"
one base "$BASE" W3 main t1; one after "$AFTER" W3 main t1
echo "$(date +%T) all done" >> "$L"; echo done > "$ROOT/measure.done"
