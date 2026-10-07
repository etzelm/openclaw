#!/bin/bash
# Post phase, same sitting: red runs of the head's query-scheduling.test.ts against the
# single-worker and pool-timeout variants, and the update_metadata log.jsonl diff.
export PATH="$HOME/homebrew/bin:$PATH"
cd ~/work/oss-166304 || exit 1
E=~/work/oss-166304-r4
HEAD_SHA=$(git rev-parse HEAD)
BASE=$(git merge-base HEAD upstream/main)
FIRST=a5af25c3924b21935856b4ff9f4e0be08d071a89
TIMEOUTV=492827c8100fcb88a9f88e7c565311c798cfa65a
SCHED=extensions/memory-wiki/src/query-scheduling.test.ts
SUPPORT=extensions/memory-wiki/src/query-scan.test-support.ts
VC=~/work/oss-166304-vault-compat
strip() { sed 's/\x1b\[[0-9;]*m//g'; }
log() { echo; echo "=== $*"; date -u +%Y-%m-%dT%H:%M:%SZ; echo "--- load: $(uptime)"; echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) | $* | $(uptime)" >> "$E/load-during-capture.txt"; }
restore_plugin() { git restore --source="$1" --staged --worktree -- extensions/memory-wiki; }
H() { node --max-old-space-size=8192 --import tsx "$E/harness.mts" "$@"; }
mkdir -p "$E/red" "$E/compat/log-diff"
{
  log "post phase start; HEAD=$HEAD_SHA"; git status --short
  for v in first-draft:$FIRST pool-timeout:$TIMEOUTV; do
    label=${v%%:*}; sha=${v#*:}
    log "RED: head $SCHED against the $label variant ($sha)"
    restore_plugin "$sha"; git checkout HEAD -- "$SCHED" "$SUPPORT"; git status --short
    pnpm vitest run "$SCHED" 2>&1 | strip > "$E/red/red-$label-query-scheduling.log"; echo "exit=${PIPESTATUS[0]}"
    grep -E '✓|×|→|Tests ' "$E/red/red-$label-query-scheduling.log"
  done
  restore_plugin HEAD; git status --short
  FIXED=832afc5b07d17847c16c8316b66a82db0b2b283b
  log "CPU: fixed 64-page batch tasks ($FIXED) against the head, three alternating runs, GC traced"
  mkdir -p "$E/cpu"
  git diff 19353569c95d0e77c33b30bcf7b4c6bb097087cf "$FIXED" -- extensions/memory-wiki/src/query-reader.ts extensions/memory-wiki/src/query-pages.ts > "$E/cpu/fixed-batches-variant.diff"
  for rep in 1 2 3; do
    for tree in head fixed-batches; do
      sha=$HEAD_SHA; [ $tree = fixed-batches ] && sha=$FIXED
      restore_plugin "$sha"
      node --trace-gc --max-old-space-size=8192 --import tsx "$E/harness.mts" search --vault ~/work/oss-166304-vault-10k --query "cobalt lantern ledger harbor" --out "$E/cpu/$tree-$rep.json" --label "$tree" > "$E/cpu/$tree-$rep.gc.log" 2>&1
      W=$(grep -oE "^\[[0-9]+:0x[0-9a-f]+\]" "$E/cpu/$tree-$rep.gc.log" | sort | uniq -c | sort -rn | head -1 | awk '{print $2}')
      echo "$tree run $rep: $(node -e 'const j=require(process.argv[1]);console.log("processCpuMs",j.processCpuMs,"searchWallMs",j.searchWallMs,"workerHeapPeakMb",j.memoryMb.workerHeapUsedPeak)' "$E/cpu/$tree-$rep.json") busiest-isolate scavenges $(grep -F "$W" "$E/cpu/$tree-$rep.gc.log" | grep -c Scavenge) mark-compacts $(grep -F "$W" "$E/cpu/$tree-$rep.gc.log" | grep -c Mark-Compact) of-which-low-memory-notification $(grep -F "$W" "$E/cpu/$tree-$rep.gc.log" | grep -c 'low memory notification')"
    done
  done
  restore_plugin HEAD; git status --short
  log "COMPAT: update_metadata on two fresh copies (base, head), log.jsonl diff with timestamps normalized"
  for tree in base head; do
    sha=$BASE; [ $tree = head ] && sha=$HEAD_SHA
    restore_plugin "$sha"; rm -rf "$VC-r4-log-$tree"; cp -R "$VC" "$VC-r4-log-$tree"
    H budget --vault "$VC-r4-log-$tree" --lookup page-1234 --query unused --step cli-apply --out "$E/compat/log-diff/$tree-cli-apply.json" --label log-$tree > /dev/null 2>&1; echo "$tree apply exit=$?"
  done
  restore_plugin HEAD; git status --short
  norm() { sed -E 's/[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?Z/<ts>/g' "$1"; }
  diff <(norm "$VC-r4-log-base/.openclaw-wiki/log.jsonl") <(norm "$VC-r4-log-head/.openclaw-wiki/log.jsonl") > "$E/compat/log-diff/log-jsonl.ts-normalized.diff"; echo "diff exit=$?"
  wc -l "$E/compat/log-diff/log-jsonl.ts-normalized.diff"
  rm -rf "$VC-r4-log-base" "$VC-r4-log-head"
  log "POST DONE"
} > "$E/post-run.log" 2>&1
