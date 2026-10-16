#!/bin/bash
export HARNESS_DIR=$HOME/work/pr-164796-h/harness
H=$HARNESS_DIR; T=$HOME/work/pr-164796; B=$HOME/work/pr-164796-main; L=$HOME/work/pr-164796-gates
rm -rf $H/runs; mkdir -p $H/runs
$H/run-all.sh $T after optout-allowed optin-withdrawn optin-later > $L/harness.log 2>&1
$H/run-all.sh $T after >> $L/harness.log 2>&1
$H/scenario2.sh $T after skill-config-dir-added >> $L/harness.log 2>&1
for s in interrupted-allowed interrupted-fresh interrupted-reassign-before-send interrupted-revoke-before-send interrupted-reassign-before-context interrupted-revoke-before-context; do $H/gateway-probe.sh $T after $s >> $L/harness.log 2>&1; done
PROBE_NOTE_HOOK=llm_output QUEUED_SWITCH_LOG=$H/runs/after-note-worker-commands.log EXTRA_NODE_OPTIONS="--import $H/shim/queued-switch-shim.mjs" $H/scenario.sh $T after note-resumed-allowed >> $L/harness.log 2>&1
$H/outcomes.sh after > $L/outcomes-after.txt 2>&1
if [ -f $B/openclaw.mjs ]; then
  HARNESS_ATTEST=0 $H/scenario.sh $B base allowed >> $L/harness.log 2>&1
  HARNESS_ATTEST=0 FAKE_WRITE_TRANSCRIPT=1 $H/scenario.sh $B base resumed-allowed >> $L/harness.log 2>&1
  $H/outcomes.sh base > $L/outcomes-base.txt 2>&1
else
  echo "NO BASE BUILD" >> $L/harness.log
fi
echo "harness done" >> $L/harness.log
