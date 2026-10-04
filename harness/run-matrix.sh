#!/bin/bash
# usage: run-matrix.sh <tree> <label>
H=~/work/pr164796/harness
for s in allowed different-account revoked reassign-before-send revoke-before-send empty-first-turn-switch coverage-switch skill-config-dir; do
  $H/scenario.sh "$1" "$2" $s
done
touch $H/runs/$2.matrix.done
