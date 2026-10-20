#!/bin/bash
# UPGRADE scenario of the r15 (head-13078e36) harness run, adapted from head-13078e36/gates/upgrade-run.sh.
# Turns 1-2 run on the released openclaw@2026.10.4 ($RELEASE), turns 3-5 on the tree under test ($T).
# Prereq: `pnpm build` in $T (needs $T/openclaw.mjs and $T/dist); release installed in $RELEASE.
# Does NOT wipe $H/runs (run-after.sh does); only $H/runs/after-upgrade is (re)created by scenario.sh.
export HARNESS_DIR=$HOME/work/s3-harness
export PATH=$HOME/homebrew/bin:$PATH
H=$HARNESS_DIR; T=$HOME/work/pr-164796-simplify3; RELEASE=$HOME/work/pr-164796-h/release; L=$HOME/work/s3out/harness
[ -f $T/openclaw.mjs ] && [ -d $T/dist ] || { echo "tree not built: $T/dist missing" >&2; exit 1; }
[ -f $RELEASE/node_modules/openclaw/openclaw.mjs ] || { echo "release not installed: $RELEASE" >&2; exit 1; }
mkdir -p $L
UPGRADE_FROM=$RELEASE/node_modules/openclaw UPGRADE_LABEL=v2026.10.4 $H/scenario.sh $T after upgrade > $L/upgrade.log 2>&1
$H/upgrade3.sh $H/runs/after-upgrade 2026.10.4 > $L/rec-upgrade.txt 2>&1
echo "upgrade done" >> $L/upgrade.log
# upgrade row, same format as the r15 outcomes-after.txt line (outcomes2.sh output; last line = the row)
$H/outcomes2.sh after upgrade | tail -n 1 >> $L/outcomes-after.txt
echo "upgrade row appended to $L/outcomes-after.txt" >> $L/upgrade.log
