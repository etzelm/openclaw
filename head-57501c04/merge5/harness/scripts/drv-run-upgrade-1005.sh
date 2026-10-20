#!/bin/bash
# Upgrade arm from the latest stable at round 2 (openclaw@2026.10.5), same scenario as run-upgrade.sh.
export HARNESS_DIR=$HOME/work/m5-harness
export PATH=$HOME/homebrew/bin:$PATH
H=$HARNESS_DIR; T=$HOME/work/pr-164796-m5; RELEASE=$HOME/work/pr-164796-h/release-1005; L=$HOME/work/m5-harness/out
[ -f $T/openclaw.mjs ] && [ -d $T/dist ] || { echo "tree not built" >&2; exit 1; }
[ -f $RELEASE/node_modules/openclaw/openclaw.mjs ] || { echo "release not installed: $RELEASE" >&2; exit 1; }
[ -d $H/runs/after-upgrade ] && mv $H/runs/after-upgrade $H/runs/after-upgrade-v2026.10.4
UPGRADE_FROM=$RELEASE/node_modules/openclaw UPGRADE_LABEL=v2026.10.5 $H/scenario.sh $T after upgrade > $L/upgrade-1005.log 2>&1
$H/upgrade3-1005.sh $H/runs/after-upgrade 2026.10.5 > $L/rec-upgrade-1005.txt 2>&1
$H/outcomes2.sh after upgrade | tail -n 1 > $L/outcomes-upgrade-1005.txt
mv $H/runs/after-upgrade $H/runs/after-upgrade-v2026.10.5
[ -d $H/runs/after-upgrade-v2026.10.4 ] && mv $H/runs/after-upgrade-v2026.10.4 $H/runs/after-upgrade
echo "upgrade-1005 done" >> $L/upgrade-1005.log
