#!/bin/bash
# Red/green for the first draft's regression tests (query.reads, query.abort) at the final head:
# red = head test files against the base production code, green = head.
export PATH="$HOME/homebrew/bin:$PATH"
cd ~/work/oss-166304 || exit 1
E=~/work/oss-166304-evidence
BASE=8e667761db3e749252a770d0c31006c436ec4b26
strip() { sed 's/\x1b\[[0-9;]*m//g'; }
log() { echo; echo "=== $*"; date -u +%Y-%m-%dT%H:%M:%SZ; echo "--- load: $(uptime)"; echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) | $* | $(uptime)" >> "$E/load-during-capture.txt"; }
{
  log "git state (status must be empty)"; git rev-parse HEAD; git status --short
  log "RED: head test files against base production code ($BASE)"
  git restore --source=$BASE --staged --worktree -- extensions/memory-wiki
  git checkout HEAD -- extensions/memory-wiki/src/query.reads.test.ts extensions/memory-wiki/src/query.abort.test.ts
  git status --short
  pnpm vitest run extensions/memory-wiki/src/query.reads.test.ts 2>&1 | strip > "$E/red.log"
  echo "red (query.reads) vitest exit=${PIPESTATUS[0]}"
  grep -E '✓|×|FAIL|AssertionError|expected|Tests |Test Files|Duration' "$E/red.log" | head -40
  pnpm vitest run extensions/memory-wiki/src/query.abort.test.ts 2>&1 | strip > "$E/red-abort.log"
  echo "red (query.abort) vitest exit=${PIPESTATUS[0]}"
  grep -E '✓|×|FAIL|Error|Tests |Test Files|Duration|Cannot find' "$E/red-abort.log" | head -40
  log "restore HEAD (status must be empty)"
  git restore --source=HEAD --staged --worktree -- extensions/memory-wiki; git status --short
  log "GREEN: same test files at HEAD"
  pnpm vitest run extensions/memory-wiki/src/query.reads.test.ts 2>&1 | strip > "$E/green.log"
  echo "green (query.reads) vitest exit=${PIPESTATUS[0]}"
  grep -E '✓|×|FAIL|Tests |Test Files|Duration' "$E/green.log" | head -40
  pnpm vitest run extensions/memory-wiki/src/query.abort.test.ts 2>&1 | strip > "$E/green-abort.log"
  echo "green (query.abort) vitest exit=${PIPESTATUS[0]}"
  grep -E '✓|×|FAIL|Tests |Test Files|Duration' "$E/green-abort.log" | head -40
  log "git state at end (status must be empty)"; git rev-parse HEAD; git status --short
  echo "EXIT=0"
} > ~/work/oss-166304-post.log 2>&1
cp ~/work/oss-166304-post.log "$E/post-run.log"
touch ~/work/oss-166304-post.done
