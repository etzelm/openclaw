#!/bin/bash
L=~/work/pr-164796-logs/p3; H=$HOME/work/pr-164796-h/harness; T=$HOME/work/pr-164796; B=$HOME/work/pr-164796-base
rm -rf $H/runs/after-* $H/runs/base-* $H/runs/*.done
$H/run-all.sh $T after optout-allowed optin-withdrawn optin-later > $L/harness2.log 2>&1
$H/run-all.sh $T after >> $L/harness2.log 2>&1
$H/scenario2.sh $T after skill-config-dir-added >> $L/harness2.log 2>&1
for s in interrupted-allowed interrupted-fresh interrupted-reassign-before-send interrupted-revoke-before-send interrupted-reassign-before-context interrupted-revoke-before-context; do $H/gateway-probe.sh $T after $s >> $L/harness2.log 2>&1; done
PROBE_NOTE_HOOK=llm_output QUEUED_SWITCH_LOG=$H/runs/after-note-worker-commands.log EXTRA_NODE_OPTIONS="--import $H/shim/queued-switch-shim.mjs" $H/scenario.sh $T after note-resumed-allowed >> $L/harness2.log 2>&1
UPGRADE_FROM=$HOME/work/pr-164796-rel/node_modules/openclaw UPGRADE_LABEL=v2026.10.2 $H/scenario.sh $T after upgrade >> $L/harness2.log 2>&1
# Base control: current main has no opt-in key, so it runs with the key unset.
while [ ! -f ~/work/pr-164796-logs/base-build.done ]; do sleep 20; done
if grep -q "^EXIT 0" ~/work/pr-164796-logs/base-build.log; then
  HARNESS_ATTEST=0 $H/scenario.sh $B base allowed >> $L/harness2.log 2>&1
  HARNESS_ATTEST=0 FAKE_WRITE_TRANSCRIPT=1 $H/scenario.sh $B base resumed-allowed >> $L/harness2.log 2>&1
fi
echo "harness done" >> $L/harness2.log
echo done > $L/harness2.done
