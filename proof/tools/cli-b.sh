#!/bin/bash
P=<scratch>
tree() { case $1 in before) echo <home>/work/t1-01-search-prepare-main;; after) echo <home>/work/t1-01-search-prepare;; esac; }
Q=("saffron glacier orchard" "lorem ipsum" "copper willow" "harbor lantern meadow" "cobalt ember tundra")
cd /tmp
for arm in before after; do
  uptime > $P/synthetic/$arm/logs/uptime-cli.txt
  for i in 0 1 2 3 4; do
    node $P/tools/oc.mjs $arm $(tree $arm) $P/synthetic/$arm/logs cli-search$((i+1)) count -- memory search "${Q[$i]}" --json --agent main --max-results 25
  done
done
