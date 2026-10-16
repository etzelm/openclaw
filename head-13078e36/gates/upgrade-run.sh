#!/bin/bash
export HARNESS_DIR=$HOME/work/pr-164796-h/harness
H=$HARNESS_DIR; T=$HOME/work/pr-164796; L=$HOME/work/pr-164796-gates
UPGRADE_FROM=$HOME/work/pr-164796-rel/node_modules/openclaw UPGRADE_LABEL=v2026.10.4 $H/scenario.sh $T after upgrade > $L/upgrade.log 2>&1
$H/upgrade3.sh $H/runs/after-upgrade 2026.10.4 > $L/rec-upgrade.txt 2>&1
echo "upgrade done" >> $L/upgrade.log
