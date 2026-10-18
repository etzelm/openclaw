#!/bin/bash
# usage: run-all.sh <tree> <label> [scenario...]   (default: every scenario, one sitting)
H=${HARNESS_DIR:-$HOME/work/pr-164796-h/harness}
TREE=$1; LABEL=$2; shift 2
ALL="allowed different-account revoked reassign-before-send revoke-before-send empty-first-turn-switch coverage-switch skill-config-dir skill-config-dir-persistent keychain-allowed keychain-ambiguous-prep keychain-fails-before-send keychain-fails-at-commit record-credential-mismatch record-relabel profile-timeout profile-401 expired-unattested refresh-due rotate-after-send queued-reassign resumed-allowed resumed-reassign-before-send resumed-revoke-before-send resumed-coverage-switch"
for s in ${*:-$ALL}; do
  "$H/scenario.sh" "$TREE" "$LABEL" "$s"
done
touch "$H/runs/$LABEL.all.done"
