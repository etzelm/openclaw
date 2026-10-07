#!/bin/bash
# Batch-size sweep at the head: only WIKI_SCAN_BATCH_PAGES differs per run (patched in the
# working tree, restored after). One-permit contention on 20,000 pages, then a default-capacity
# 10,000-page search.
export PATH="$HOME/homebrew/bin:$PATH"
cd ~/work/oss-166304 || exit 1
E=~/work/oss-166304-r4
QUERY="cobalt lantern ledger harbor"
F=extensions/memory-wiki/src/query-reader.ts
mkdir -p "$E/sweep"
{
  echo "HEAD=$(git rev-parse HEAD)"; git status --short
  for B in 16 64 128 256 512; do
    git checkout -- "$F"
    sed -i "" -E "s/^const WIKI_SCAN_BATCH_PAGES = [0-9]+;/const WIKI_SCAN_BATCH_PAGES = $B;/" "$F"
    echo; echo "=== batch $B $(date -u +%Y-%m-%dT%H:%M:%SZ) load: $(uptime | sed 's/.*averages: //')"; git diff --stat -- "$F" | tail -1
    node --max-old-space-size=8192 --require "$E/single-permit.cjs" --import tsx "$E/harness.mts" contention --vault ~/work/oss-166304-vault-big --query "$QUERY" --out "$E/sweep/contention-20k-b$B.json" --label "batch $B" 2>&1 | grep -E '"(scanWallMs|count|p50|p99|max|overMemorySearchDeadline30s)"' | tr -s ' ' | tr '\n' ' '; echo
    node --max-old-space-size=8192 --import tsx "$E/harness.mts" search --vault ~/work/oss-166304-vault-10k --query "$QUERY" --out "$E/sweep/search-10k-b$B.json" --label "batch $B" > "$E/sweep/search-10k-b$B.stdout" 2>&1
    node -e 'const j=require(process.argv[1]); console.log("search10k wall", j.searchWallMs, "mainCpu", j.mainThreadCpuMs, "elu", j.eventLoopUtilization, "workerHeapPeak", j.memoryMb.workerHeapUsedPeak)' "$E/sweep/search-10k-b$B.json"
  done
  git checkout -- "$F"; git status --short; echo SWEEP DONE
} > "$E/sweep/sweep-run.log" 2>&1
