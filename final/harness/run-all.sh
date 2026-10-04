#!/bin/bash
# usage: run-all.sh <tree> <label>   (all scenarios, one sitting)
H=$HOME/work/164796-harness
for s in allowed different-account revoked reassign-before-send revoke-before-send empty-first-turn-switch coverage-switch skill-config-dir skill-config-dir-persistent keychain-allowed keychain-ambiguous-prep keychain-fails-before-send keychain-fails-at-commit; do
  $H/scenario.sh "$1" "$2" $s
done
touch $H/runs/$2.all.done
