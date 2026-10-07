#!/bin/bash
# Build, profiler and built-CLI evidence for openclaw/openclaw#166304.
export PATH="$HOME/homebrew/bin:$PATH"
cd ~/work/oss-166304 || exit 1
E=~/work/oss-166304-evidence
BASE=8e667761db3e749252a770d0c31006c436ec4b26
mkdir -p "$E/before" "$E/after"
strip() { sed 's/\x1b\[[0-9;]*m//g'; }
log() { echo; echo "=== $*"; date -u +%Y-%m-%dT%H:%M:%SZ; }
cli_run() {
  # Built CLI with a 180 s watchdog: a process kept alive by a worker thread would hang.
  local label=$1; shift
  local start end code
  start=$(date +%s.%N)
  OPENCLAW_STATE_DIR="$STATE" OPENCLAW_CONFIG_PATH="$STATE/openclaw.json" node openclaw.mjs "$@" > "$E/cli-$label.out" 2>&1 &
  local pid=$!
  for _ in $(seq 1 180); do kill -0 $pid 2>/dev/null || break; sleep 1; done
  if kill -0 $pid 2>/dev/null; then kill -TERM $pid; code="killed-by-watchdog"; else wait $pid; code=$?; fi
  end=$(date +%s.%N)
  echo "--- $label: node openclaw.mjs $* -> exit=$code wall=$(echo "$end - $start" | bc) s, $(grep -c '"path"' "$E/cli-$label.out") result paths, output head: $(head -c 160 "$E/cli-$label.out" | tr '\n' ' ')"
}
{
  log "git state (status must be empty)"; git rev-parse HEAD; git status --short

  log "standalone plugin build: node scripts/lib/plugin-npm-runtime-build.mjs extensions/memory-wiki"
  node scripts/lib/plugin-npm-runtime-build.mjs extensions/memory-wiki 2>&1 | strip | tee "$E/build-standalone.log"
  echo "standalone build exit=${PIPESTATUS[0]}"
  echo "--- extensions/memory-wiki/dist worker files"; find extensions/memory-wiki/dist -name '*worker*' -exec ls -la {} \;
  git status --short

  log "root bundled build: pnpm build (AFTER, HEAD)"
  pnpm build 2>&1 | strip > "$E/build.log"
  echo "pnpm build exit=${PIPESTATUS[0]}"; grep -E '^\[build-all\]' "$E/build.log" | tail -30
  echo "--- dist/extensions/memory-wiki worker files"; find dist/extensions/memory-wiki -name '*worker*' -exec ls -la {} \;
  echo "--- dist/extensions/memory-wiki listing"; ls dist/extensions/memory-wiki; ls dist/extensions/memory-wiki/src 2>/dev/null | head -20
  echo "--- worker imports"; grep -o 'from "[^"]*"' dist/extensions/memory-wiki/src/query-reader.worker.js | head -10

  log "profiler AFTER: OPENCLAW_LOCAL_CHECK=0 node --import tsx scripts/profile-extension-memory.mts --extension memory-wiki --skip-combined --concurrency 1"
  env OPENCLAW_LOCAL_CHECK=0 node --import tsx scripts/profile-extension-memory.mts --extension memory-wiki --skip-combined --concurrency 1 2>&1 | strip | tee "$E/after/profile.log" | grep -E '^\[extension-memory\]|"maxRssMb"|"deltaFromBaselineMb"|"totalCpuUs"|"qualified"|"baselineMb"'
  echo "profiler exit=${PIPESTATUS[0]}"

  log "BEFORE: restore extensions/memory-wiki to base $BASE, rebuild, profile"
  git restore --source=$BASE --staged --worktree -- extensions/memory-wiki
  git status --short | head
  pnpm build 2>&1 | strip > "$E/before/build.log"
  echo "pnpm build (base plugin) exit=${PIPESTATUS[0]}"; grep -E '^\[build-all\]' "$E/before/build.log" | tail -5
  echo "--- dist/extensions/memory-wiki worker files at base (expect none)"; find dist/extensions/memory-wiki -name '*worker*' -exec ls -la {} \;
  env OPENCLAW_LOCAL_CHECK=0 node --import tsx scripts/profile-extension-memory.mts --extension memory-wiki --skip-combined --concurrency 1 2>&1 | strip | tee "$E/before/profile.log" | grep -E '^\[extension-memory\]|"maxRssMb"|"deltaFromBaselineMb"|"totalCpuUs"|"qualified"|"baselineMb"'
  echo "profiler exit=${PIPESTATUS[0]}"

  log "restore HEAD (status must be empty)"
  git restore --source=HEAD --staged --worktree -- extensions/memory-wiki
  git status --short
  git rev-parse HEAD

  log "rebuild dist at HEAD for the built-CLI run"
  pnpm build 2>&1 | strip > "$E/headbuild.log"
  echo "pnpm build (head, second time) exit=${PIPESTATUS[0]}"; grep -E '^\[build-all\] phase timings' "$E/headbuild.log"
  ls -la dist/extensions/memory-wiki/src/query-reader.worker.js

  log "built CLI: node openclaw.mjs wiki status / wiki search / wiki get against the vault left by the evidence run (2,500 generated pages)"
  STATE=~/work/oss-166304-cli-state; rm -rf "$STATE"; mkdir -p "$STATE"
  printf '{ "plugins": { "entries": { "memory-wiki": { "enabled": true, "config": { "vault": { "scope": "global", "path": "%s/work/oss-166304-vault-" }, "search": { "backend": "local", "corpus": "wiki" }, "obsidian": { "enabled": false, "useOfficialCli": false }, "ingest": { "autoCompile": false } } } } } }\n' "$HOME" > "$STATE/openclaw.json"
  echo "vault md files: $(find ~/work/oss-166304-vault- -name '*.md' | wc -l) (2,500 generated pages plus the scaffold's AGENTS.md, WIKI.md, inbox.md, index.md)"
  echo "--- wiki status --json (vault resolution)"
  OPENCLAW_STATE_DIR="$STATE" OPENCLAW_CONFIG_PATH="$STATE/openclaw.json" node openclaw.mjs wiki status --json 2>&1 | strip | grep -E '"vaultPath"|"vaultExists"|"vaultScope"'
  cli_run search1 wiki search "cobalt lantern ledger" --max-results 3 --json
  cli_run search2 wiki search "cobalt lantern ledger" --max-results 3 --json
  cli_run get1 wiki get entities/page-1.md --lines 2
  rm -rf "$STATE"
  echo "EXIT=0"
} > ~/work/oss-166304-build.log 2>&1
cp ~/work/oss-166304-build.log "$E/build-run.log"
touch ~/work/oss-166304-build.done
