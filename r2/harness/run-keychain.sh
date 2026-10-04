#!/bin/bash
# usage: run-keychain.sh <tree> <label>
H=~/work/p164796c/harness
for s in keychain-allowed keychain-ambiguous-prep keychain-fails-before-send keychain-fails-at-commit; do
  $H/scenario.sh "$1" "$2" $s
done
touch $H/runs/$2.keychain.done
