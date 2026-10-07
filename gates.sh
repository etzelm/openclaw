#!/bin/bash
export PATH="$HOME/homebrew/bin:$PATH"
cd ~/work/oss-166304 || exit 1
E=~/work/oss-166304-evidence; mkdir -p "$E"
strip() { sed 's/\x1b\[[0-9;]*m//g'; }
{
  echo "=== gates start $(date -u +%Y-%m-%dT%H:%M:%SZ)"; git rev-parse HEAD; git status --short; uname -a; uptime
  echo "=== lane: pnpm vitest run extensions/memory-wiki/"
  pnpm vitest run extensions/memory-wiki/ 2>&1 | strip > "$E/tests.log"; echo "lane exit=${PIPESTATUS[0]}"; tail -6 "$E/tests.log"
  echo "=== check:changed --base origin/main"; uptime
  pnpm check:changed --base origin/main 2>&1 | strip > "$E/check-changed.log"; echo "check:changed exit=${PIPESTATUS[0]}"; tail -8 "$E/check-changed.log"
  echo "=== changed:lanes"; pnpm changed:lanes --json --base origin/main 2>&1 | strip > "$E/changed-lanes.json"; cat "$E/changed-lanes.json"
  echo "=== git diff --check origin/main HEAD"; git diff --check origin/main HEAD && echo "diff --check clean"
  echo "=== gates end $(date -u +%Y-%m-%dT%H:%M:%SZ)"; uptime
} > "$E/gates.log" 2>&1
touch ~/work/oss-166304-gates.done
