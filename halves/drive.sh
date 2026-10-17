#!/bin/bash
# usage: drive.sh aux | timing
set -u
H=<scratch>/halves
W=<home>/work
root() { case $1 in BASE) echo $W/t1-01-search-prepare-main;; M1) echo $W/t1-01-half-M1;; M2) echo $W/t1-01-half-M2;; FULL) echo $W/t1-01-search-prepare;; esac; }
load1() { uptime | sed 's/.*load averages*: *//' | awk '{print $1}' | tr -d ','; }
waitload() { # sets waited, l ; logs to $LOG
  waited=0
  while :; do
    l=$(load1)
    echo "$(date +%T) $1: load1=$l (uptime: $(uptime | sed 's/.*load/load/'))" >> $LOG
    if awk "BEGIN{exit !($l <= 6)}" || [ $waited -ge 1200 ]; then break; fi
    sleep 60; waited=$((waited+60))
  done
}
if [ "$1" = aux ]; then
  LOG=$H/raw/aux.log; : > $LOG
  for S in dev main; do for A in BASE M1 M2 FULL; do for M in parity compiles; do
    node $H/measure-search.mjs $(root $A) $H/stores/$S.sqlite $M --out $H/raw/$S-$M-$A.json >> $LOG 2>&1
    echo "$(date +%T) $S $M $A exit=$?" >> $LOG
  done; done; done
  echo "EXIT 0" >> $LOG
else
  for S in dev main; do
    if [ $S = dev ]; then N=400; else N=200; fi
    LOG=$H/raw/timing-$S.log; : > $LOG
    i=0
    for step in "1 BASE" "1 M1" "1 M2" "1 FULL" "2 FULL" "2 M2" "2 M1" "2 BASE"; do
      set -- $step; round=$1; A=$2; i=$((i+1))
      waitload "run$i round$round $A"
      echo "$(date +%T) run$i start, waited ${waited}s, load1=$l" >> $LOG
      node $H/measure-search.mjs $(root $A) $H/stores/$S.sqlite timing --n $N --out $H/raw/timing-$S-run$i-r$round-$A.json >> $LOG 2>&1
      echo "$(date +%T) run$i done exit=$? load1_after=$(load1) waitedSeconds=$waited" >> $LOG
      echo "{\"waitedSeconds\":$waited,\"load1AtStart\":$l,\"load1AtEnd\":$(load1)}" > $H/raw/timing-$S-run$i-load.json
    done
    echo "EXIT 0" >> $LOG
  done
fi
