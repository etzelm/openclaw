#!/bin/bash
# After the gates: rerun the probe-note row with the restored plugin, then the upgrade arm from 2026.10.5.
G=~/work/pr-164796-simplify2-gates; S=$G/summary-post.txt
while [ ! -f $G/gates.done ]; do sleep 30; done
export HARNESS_DIR=$HOME/work/pr-164796-h/harness PATH=$HOME/homebrew/bin:$PATH
H=$HARNESS_DIR; T=$HOME/work/pr-164796-simplify2; L=$HOME/work/pr-164796-h/logs
cd $T; echo "HEAD $(git rev-parse HEAD) TREE $(git rev-parse HEAD^{tree}) dirty=$(git status --porcelain | wc -l | tr -d ' ')" > $S
echo "probe-note plugin restored from evidence commit 1e6c130ad78e head-5fd72055/harness/plugins/probe-note: $(ls $H/plugins/probe-note | tr '\n' ' ')" >> $S
PROBE_NOTE_HOOK=llm_output QUEUED_SWITCH_LOG=$H/runs/after-note-worker-commands.log EXTRA_NODE_OPTIONS="--import $H/shim/queued-switch-shim.mjs" $H/scenario.sh $T after note-resumed-allowed > $L/note-rerun.log 2>&1; echo "note-resumed-allowed rerun EXIT $?" >> $S
$H/outcomes2.sh after note-resumed-allowed | tail -n 1 > $L/outcomes-note-rerun.txt
echo "row: $(cat $L/outcomes-note-rerun.txt)" >> $S
echo "r15 row: $(grep '^note-resumed-allowed ' ~/work/pr-164796-h/ref/outcomes-after.txt)" >> $S
echo "prev-merge row: $(grep '^note-resumed-allowed ' ~/work/pr-164796-h/ref/outcomes-after.prevmerge.txt)" >> $S
bash ~/work/pr-164796-h/run-upgrade-1005.sh > $G/harness-upgrade-1005.out 2>&1; echo "harness run-upgrade-1005 EXIT $?" >> $S
echo "upgrade 2026.10.5 row: $(cat $L/outcomes-upgrade-1005.txt)" >> $S
echo "upgrade 2026.10.4 row: $(grep '^upgrade ' $L/outcomes-after.txt)" >> $S
echo "end HEAD $(git rev-parse HEAD) dirty=$(git status --porcelain | wc -l | tr -d ' ')" >> $S
echo POST DONE >> $S
