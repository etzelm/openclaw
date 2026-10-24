#!/bin/bash
# usage: run-arm.sh <label>   Runs every scenario against the built worktree, sequentially.
H=$HARNESS
TREE=~/.claude/repos/openclaw-pr-178929
SCENS="managed-control managed-static-env managed-static-helper managed-before-send resumed-managed-control resumed-managed-before-send resumed-managed-before-context note-resumed-probe"
for s in $SCENS; do "$H/scenario.sh" "$TREE" "$1" "$s"; echo "$1 $s done"; done
export PATH=$SCRATCH/upstream/node24bin:$PATH
node "$H/outcomes.mjs" "$H/runs" "$1" $SCENS
