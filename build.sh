#!/bin/bash
# Build proof for openclaw/openclaw#166433 follow-up: the worker file is still emitted.
export PATH="$HOME/homebrew/bin:$PATH"
cd ~/work/oss-166304 || exit 1
E=~/work/oss-166304-evidence
strip() { sed 's/\x1b\[[0-9;]*m//g'; }
log() { echo; echo "=== $*"; date -u +%Y-%m-%dT%H:%M:%SZ; echo "--- load: $(uptime)"; echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) | $* | $(uptime)" >> "$E/load-during-capture.txt"; }
{
  log "git state (status must be empty)"; git rev-parse HEAD; git status --short
  log "standalone plugin build: node scripts/lib/plugin-npm-runtime-build.mjs extensions/memory-wiki"
  node scripts/lib/plugin-npm-runtime-build.mjs extensions/memory-wiki 2>&1 | strip | tee "$E/build-standalone.log"
  echo "standalone build exit=${PIPESTATUS[0]}"
  echo "--- extensions/memory-wiki/dist worker files"; find extensions/memory-wiki/dist -name '*worker*' -exec ls -la {} \;
  git status --short
  log "root bundled build: pnpm build (new head)"
  pnpm build 2>&1 | strip > "$E/build.log"
  echo "pnpm build exit=${PIPESTATUS[0]}"; grep -E '^\[build-all\] phase timings' "$E/build.log"
  echo "--- dist/extensions/memory-wiki worker files"; find dist/extensions/memory-wiki -name '*worker*' -exec ls -la {} \;
  echo "--- worker imports"; grep -o 'from "[^"]*"' dist/extensions/memory-wiki/src/query-reader.worker.js | head -10
  log "build end"; git status --short
  echo "EXIT=0"
} > ~/work/oss-166304-build.log 2>&1
cp ~/work/oss-166304-build.log "$E/build-run.log"
touch ~/work/oss-166304-build.done
