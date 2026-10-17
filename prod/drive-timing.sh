#!/bin/bash
# usage: drive-timing.sh <dev|main> <N>   (rounds: r1 = BEFORE,AFTER ; r2 = AFTER,BEFORE)
set -u
S=$1; N=$2
P=<scratch>/prod
W=<home>/work
LOG=$P/raw/timing-$S.log
load1() { uptime | sed 's/.*load averages*: *//' | awk '{print $1}' | tr -d ','; }
: > $LOG
i=0
for step in "1 before" "1 after" "2 after" "2 before"; do
  set -- $step; round=$1; arm=$2
  i=$((i+1))
  waited=0
  while :; do
    l=$(load1)
    echo "$(date +%T) run$i round$round $arm: load1=$l (uptime: $(uptime | sed 's/.*load/load/'))" >> $LOG
    if awk "BEGIN{exit !($l <= 8)}" || [ $waited -ge 1200 ]; then break; fi
    sleep 60; waited=$((waited+60))
  done
  echo "$(date +%T) run$i start, waited ${waited}s, load1=$l" >> $LOG
  if [ $arm = before ]; then ROOT=$W/t1-01-search-prepare-main; else ROOT=$W/t1-01-search-prepare; fi
  s=$(date +%s.%N 2>/dev/null || date +%s)
  node $P/measure-search.mjs $ROOT $P/stores/$S-$arm.sqlite timing --n $N --out $P/raw/timing-$S-run$i-r$round-$arm.json >> $LOG 2>&1
  echo "$(date +%T) run$i done exit=$? load1_after=$(load1) waitedSeconds=$waited" >> $LOG
  echo "{\"waitedSeconds\":$waited,\"load1AtStart\":$l,\"load1AtEnd\":$(load1)}" > $P/raw/timing-$S-run$i-load.json
done
echo "EXIT 0" >> $LOG
