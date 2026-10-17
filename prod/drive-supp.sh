#!/bin/bash
# Supplemental (beyond the protocol's 2 rounds): 8 extra runs per store, ABBA ABBA: before after after before before after after before.
# usage: drive-supp.sh <dev|main> <N>
set -u
S=$1; N=$2
P=<scratch>/prod; W=<home>/work
LOG=$P/raw/supp-$S.log
load1() { uptime | sed 's/.*load averages*: *//' | awk '{print $1}' | tr -d ','; }
: > $LOG
i=0
for arm in before after after before before after after before; do
  i=$((i+1)); waited=0
  while :; do
    l=$(load1)
    echo "$(date +%T) supp run$i $arm: load1=$l" >> $LOG
    if awk "BEGIN{exit !($l <= 8)}" || [ $waited -ge 1200 ]; then break; fi
    sleep 60; waited=$((waited+60))
  done
  if [ $arm = before ]; then ROOT=$W/t1-01-search-prepare-main; else ROOT=$W/t1-01-search-prepare; fi
  node $P/measure-search.mjs $ROOT $P/stores/$S-$arm.sqlite timing --n $N --out $P/raw/supp-$S-run$i-$arm.json >> $LOG 2>&1
  echo "{\"waitedSeconds\":$waited,\"load1AtStart\":$l,\"load1AtEnd\":$(load1)}" > $P/raw/supp-$S-run$i-load.json
  echo "$(date +%T) supp run$i done exit=$?" >> $LOG
done
echo "EXIT 0" >> $LOG
