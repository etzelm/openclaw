#!/bin/bash
# AFTER scenarios of the r15 (head-13078e36) harness run, against the tree under test.
# Adapted from head-13078e36/gates/harness-run.sh: same scenarios, same order, outcomes2.sh,
# base scenarios skipped (base outcomes are reused), upgrade scenario not included (upgrade-run.sh).
# Prereq: `pnpm build` in $T (needs $T/openclaw.mjs and $T/dist).
export HARNESS_DIR=$HOME/work/pr-164796-h/harness
export PATH=$HOME/homebrew/bin:$PATH
H=$HARNESS_DIR; T=$HOME/work/pr-164796-simplify2; L=$HOME/work/pr-164796-h/logs
[ -f $T/openclaw.mjs ] && [ -d $T/dist ] || { echo "tree not built: $T/dist missing" >&2; exit 1; }
mkdir -p $L
rm -rf $H/runs; mkdir -p $H/runs
echo "start $(date -u +%FT%TZ) tree=$(git -C $T rev-parse HEAD) tree-sha=$(git -C $T rev-parse 'HEAD^{tree}')" > $L/harness.log
$H/run-all.sh $T after optout-allowed optin-withdrawn optin-later >> $L/harness.log 2>&1
$H/run-all.sh $T after >> $L/harness.log 2>&1
$H/scenario2.sh $T after skill-config-dir-added >> $L/harness.log 2>&1
for s in interrupted-allowed interrupted-fresh interrupted-reassign-before-send interrupted-revoke-before-send interrupted-reassign-before-context interrupted-revoke-before-context; do $H/gateway-probe.sh $T after $s >> $L/harness.log 2>&1; done
PROBE_NOTE_HOOK=llm_output QUEUED_SWITCH_LOG=$H/runs/after-note-worker-commands.log EXTRA_NODE_OPTIONS="--import $H/shim/queued-switch-shim.mjs" $H/scenario.sh $T after note-resumed-allowed >> $L/harness.log 2>&1
$H/outcomes2.sh after > $L/outcomes-after.txt 2>&1
echo "harness done $(date -u +%FT%TZ)" >> $L/harness.log
