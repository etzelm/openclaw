#!/bin/bash
# Evidence capture for openclaw/openclaw#166304: BEFORE/AFTER through the real
# searchMemoryWiki seam on two generated vaults in one sitting, the red/green runs,
# and base-versus-head test cost for the two files that now spawn the worker.
export PATH="$HOME/homebrew/bin:$PATH"
cd ~/work/oss-166304 || exit 1
E=~/work/oss-166304-evidence
BASE=8e667761db3e749252a770d0c31006c436ec4b26
QUERY="cobalt lantern ledger harbor"
strip() { sed 's/\x1b\[[0-9;]*m//g'; }
log() { echo; echo "=== $*"; date -u +%Y-%m-%dT%H:%M:%SZ; }
compare() {
  node -e '
    const fs = require("node:fs");
    const b = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    const a = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
    const before = b.results, after = a.results;
    const identical = JSON.stringify(before) === JSON.stringify(after);
    const differences = [];
    for (let i = 0; i < Math.max(before.length, after.length); i += 1) {
      if (JSON.stringify(before[i]) !== JSON.stringify(after[i])) {
        differences.push({ index: i, before: before[i] ?? null, after: after[i] ?? null });
      }
    }
    console.log(JSON.stringify({
      comparison: "JSON.stringify of every result object, all fields, in order",
      beforeCount: before.length, afterCount: after.length,
      identicalResults: identical, differences,
      fieldsPerResult: [...new Set(before.flatMap((r) => Object.keys(r)))],
    }, null, 2));
  ' "$1" "$2"
}
run_round() {
  local pages=$1 tag=$2 V=~/work/oss-166304-vault-$tag
  mkdir -p "$E/before$tag" "$E/after$tag"
  log "generate vault ($pages pages)"
  rm -rf "$V"
  node --import tsx "$E/harness.mts" generate --vault "$V" --pages "$pages" --lines 120 --claims 60 | tee "$E/vault-generate$tag.json"
  du -sh "$V"; find "$V" -name '*.md' | wc -l
  log "AFTER ($pages pages): harness at HEAD"
  git rev-parse HEAD > "$E/after$tag/git-head.txt"; git status --short > "$E/after$tag/git-status.txt"
  node --max-old-space-size=8192 --import tsx "$E/harness.mts" search --vault "$V" --query "$QUERY" --out "$E/after$tag/search.json" --label after > "$E/after$tag/search.stdout" 2>&1
  echo "after exit=$?"; grep -v '^\s*"\(results\|snippet\)' "$E/after$tag/search.stdout" | head -60
  log "BEFORE ($pages pages): restore extensions/memory-wiki to base $BASE (production and tests)"
  git restore --source=$BASE --staged --worktree -- extensions/memory-wiki
  git status --short | tee "$E/before$tag/git-status.txt"
  echo "new modules present after restore? (expect: none)"; ls extensions/memory-wiki/src/query-reader.ts extensions/memory-wiki/src/query-reader.worker.ts extensions/memory-wiki/src/query-scoring.ts 2>&1
  git rev-parse HEAD > "$E/before$tag/git-head.txt"
  node --max-old-space-size=8192 --import tsx "$E/harness.mts" search --vault "$V" --query "$QUERY" --out "$E/before$tag/search.json" --label before > "$E/before$tag/search.stdout" 2>&1
  echo "before exit=$?"; grep -v '^\s*"\(results\|snippet\)' "$E/before$tag/search.stdout" | head -60
  log "compare every result object ($pages pages)"
  compare "$E/before$tag/search.json" "$E/after$tag/search.json" | tee "$E/results-compare$tag.json" | head -12
}
{
  log "git state at start (status must be empty)"
  git rev-parse HEAD; git status --short
  log "machine"
  uname -a; node --version; sysctl -n machdep.cpu.brand_string hw.ncpu hw.memsize 2>/dev/null

  run_round 10000 ""

  log "BASE test cost while the plugin is restored to base (pnpm test <file> --maxWorkers=1)"
  for f in extensions/memory-wiki/src/query.test.ts extensions/memory-wiki/src/apply.test.ts extensions/memory-wiki/src/query.reads.test.ts; do
    echo "--- base: $f"
    /usr/bin/time -p pnpm test "$f" --maxWorkers=1 2>&1 | strip | grep -E 'Test Files|Tests |Duration|^real|^user|FAIL|×' | tail -8
  done

  log "RED: HEAD test files against base production code"
  git checkout HEAD -- extensions/memory-wiki/src/query.reads.test.ts extensions/memory-wiki/src/query.abort.test.ts
  git status --short
  pnpm vitest run extensions/memory-wiki/src/query.reads.test.ts 2>&1 | strip > "$E/red.log"
  echo "red (query.reads) vitest exit=${PIPESTATUS[0]}"
  grep -E '✓|×|FAIL|AssertionError|expected|Tests |Test Files|Duration' "$E/red.log" | head -40
  pnpm vitest run extensions/memory-wiki/src/query.abort.test.ts 2>&1 | strip > "$E/red-abort.log"
  echo "red (query.abort) vitest exit=${PIPESTATUS[0]}"
  grep -E '✓|×|FAIL|Error|Tests |Test Files|Duration|Cannot find|not a function' "$E/red-abort.log" | head -40

  log "restore HEAD (status must be empty)"
  git restore --source=HEAD --staged --worktree -- extensions/memory-wiki
  git status --short

  log "GREEN: same test files at HEAD"
  pnpm vitest run extensions/memory-wiki/src/query.reads.test.ts 2>&1 | strip > "$E/green.log"
  echo "green (query.reads) vitest exit=${PIPESTATUS[0]}"
  grep -E '✓|×|FAIL|Tests |Test Files|Duration' "$E/green.log" | head -40
  pnpm vitest run extensions/memory-wiki/src/query.abort.test.ts 2>&1 | strip > "$E/green-abort.log"
  echo "green (query.abort) vitest exit=${PIPESTATUS[0]}"
  grep -E '✓|×|FAIL|Tests |Test Files|Duration' "$E/green-abort.log" | head -40

  run_round 2500 "-2500pages"

  log "restore HEAD (status must be empty)"
  git restore --source=HEAD --staged --worktree -- extensions/memory-wiki
  git status --short

  log "git state at end (status must be empty)"
  git rev-parse HEAD; git status --short
  echo "EXIT=0"
} > ~/work/oss-166304-evidence.log 2>&1
cp ~/work/oss-166304-evidence.log "$E/evidence-run.log"
touch ~/work/oss-166304-evidence.done
