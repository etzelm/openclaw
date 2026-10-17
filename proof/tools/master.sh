#!/bin/bash
P=<scratch>
cd /tmp
echo "START $(date) $(uptime)"
bash $P/tools/cli-b.sh
node $P/tools/run-gw.mjs before count c1 18801
node $P/tools/run-gw.mjs after count c1 18802
node $P/tools/run-gw.mjs before time t1 18801
node $P/tools/run-gw.mjs after time t1 18802
node $P/tools/run-gw.mjs after time t2 18802
node $P/tools/run-gw.mjs before time t2 18801
echo "ALL DONE $(date) $(uptime)"
