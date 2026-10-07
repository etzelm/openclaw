#!/bin/bash
# Second script of the same sitting at 4586e654884: red/green for the other changed test files
# and warm per-file test cost for every touched test file.
export PATH="$HOME/homebrew/bin:$PATH"
cd ~/work/oss-166304 || exit 1
E=~/work/oss-166304-r3-post
BASE=$(git merge-base HEAD upstream/main)
FIRST=a5af25c3924b21935856b4ff9f4e0be08d071a89
strip() { sed 's/\x1b\[[0-9;]*m//g'; }
log() { echo; echo "=== $*"; date -u +%Y-%m-%dT%H:%M:%SZ; echo "--- load: $(uptime)"; echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) | $* | $(uptime)" >> "$E/load-during-capture.txt"; }
restore_plugin() { git restore --source="$1" --staged --worktree -- extensions/memory-wiki; }
run() { pnpm vitest run "$1" 2>&1 | strip > "$2"; echo "$(basename "$2") exit=${PIPESTATUS[0]}"; grep -E '✓|×|→|FAIL|Error:|Tests |Test Files|Start at|Duration' "$2" | head -40; }
mkdir -p "$E"; : > "$E/load-during-capture.txt"
R=extensions/memory-wiki/src/query-reader.test.ts
Q=extensions/memory-wiki/src/query.reads.test.ts
A=extensions/memory-wiki/src/query.abort.test.ts
{
  log "git state at start (status must be empty)"; git rev-parse HEAD; git status --short
  log "RED: $R against the first draft's production code ($FIRST)"
  restore_plugin "$FIRST"; git checkout HEAD -- "$R"; git status --short
  run "$R" "$E/red-reader.log"
  log "RED: $Q and $A against base production code ($BASE)"
  restore_plugin "$BASE"; git checkout HEAD -- "$Q" "$A"; git status --short
  run "$Q" "$E/red-reads.log"
  run "$A" "$E/red-abort.log"
  restore_plugin HEAD; git status --short
  log "GREEN: the same files at the head"
  run "$R" "$E/green-reader.log"
  run "$Q" "$E/green-reads.log"
  run "$A" "$E/green-abort.log"
  log "TEST COST at the head: one untimed warm-up run per file, then the timed run (pnpm test <file> --maxWorkers=1)"
  for f in "$R" extensions/memory-wiki/src/query-scheduling.test.ts "$Q" "$A" extensions/memory-wiki/src/tool.deadline.test.ts extensions/memory-wiki/index.test.ts; do
    pnpm test "$f" --maxWorkers=1 > /dev/null 2>&1
    echo "--- head (warm): $f"
    /usr/bin/time -p pnpm test "$f" --maxWorkers=1 2>&1 | strip | grep -E 'Test Files|Tests |Duration|^real|^user|FAIL|×' | tail -8
  done
  log "git state at end (status must be empty)"; git rev-parse HEAD; git status --short
  echo "EXIT=0"
} > "$E/post-run.log" 2>&1
cp "$0" "$E/post.sh"
touch ~/work/oss-166304-r3-post.done
