#!/bin/bash
# Round 2 captures at the pushed tree: every scenario with the synthetic child that answers the
# UserPromptSubmit hook, then the Gateway interrupted-input scenarios.
H=$HOME/work/pr-164796-h/harness; T=$HOME/work/pr-164796
$H/run-all.sh $T after
$H/scenario2.sh $T after skill-config-dir-added
UPGRADE_FROM=$HOME/homebrew/lib/node_modules/openclaw UPGRADE_LABEL=v2026.10.1 $H/scenario.sh $T after upgrade
for s in interrupted-allowed interrupted-fresh interrupted-reassign-before-send interrupted-revoke-before-send; do $H/gateway-probe.sh $T after $s; done
PROBE_NOTE_HOOK=llm_output QUEUED_SWITCH_LOG=$H/runs/after-note-worker-commands.log EXTRA_NODE_OPTIONS="--import $H/shim/queued-switch-shim.mjs" $H/scenario.sh $T after note-resumed-allowed
echo round2-done
