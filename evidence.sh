#!/bin/bash
# Evidence capture for openclaw/openclaw#166433 follow-up (short reads off the scan
# queue, two-worker pool, 30 s task bound). One sitting at the new head:
#   concurrent-read harness: BEFORE = published head (a5af25c), AFTER = new head;
#   10,000-page search pair: BEFORE = base (8e66776), AFTER = new head, every result compared;
#   red/green for the scheduling tests and the reworked reader tests; warm test cost.
export PATH="$HOME/homebrew/bin:$PATH"
cd ~/work/oss-166304 || exit 1
E=~/work/oss-166304-evidence
BASE=8e667761db3e749252a770d0c31006c436ec4b26
PUBLISHED=a5af25c3924b21935856b4ff9f4e0be08d071a89
QUERY="cobalt lantern ledger harbor"
V=~/work/oss-166304-vault-
strip() { sed 's/\x1b\[[0-9;]*m//g'; }
log() { echo; echo "=== $*"; date -u +%Y-%m-%dT%H:%M:%SZ; echo "--- load: $(uptime)"; echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) | $* | $(uptime)" >> "$E/load-during-capture.txt"; }
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
restore_plugin() { git restore --source="$1" --staged --worktree -- extensions/memory-wiki; }
record_tree() { git rev-parse HEAD > "$1/git-head.txt"; git status --short > "$1/git-status.txt"; }
mkdir -p "$E/after" "$E/before" "$E/before-pr"
echo "# uptime at the start and end of every phase (phase | sample); machine: $(uname -n | sed 's/.*/<host>/')" >> "$E/load-during-capture.txt"
{
  log "git state at start (status must be empty)"
  git rev-parse HEAD; git status --short
  log "machine"
  uname -a; node --version; sysctl -n machdep.cpu.brand_string hw.ncpu hw.memsize 2>/dev/null
  echo "--- top CPU consumers"; ps -Ao pcpu,etime,comm -r | head -6

  log "generate vault (10,000 pages, 60 body lines and 30 claims per page: the first draft's 120/60 vault scans in about 40 s on this loaded machine, past the 30 s task bound; see bound/)"
  rm -rf "$V"
  node --import tsx "$E/harness.mts" generate --vault "$V" --pages 10000 --lines 60 --claims 30 | tee "$E/vault-generate.json"
  du -sh "$V"; find "$V" -name '*.md' | wc -l

  log "AFTER (new head): 10,000-page search"
  record_tree "$E/after"
  node --max-old-space-size=8192 --import tsx "$E/harness.mts" search --vault "$V" --query "$QUERY" --out "$E/after/search.json" --label after > "$E/after/search.stdout" 2>&1
  echo "after search exit=$?"; grep -v '^\s*"\(results\|snippet\)' "$E/after/search.stdout" | head -60
  log "AFTER (new head): concurrent exact-path reads during a 10,000-page scan"
  node --max-old-space-size=8192 --import tsx "$E/harness.mts" concurrent --vault "$V" --query "$QUERY" --out "$E/after/concurrent.json" --label after > "$E/after/concurrent.stdout" 2>&1
  echo "after concurrent exit=$?"; cat "$E/after/concurrent.stdout"

  log "BEFORE-PR (published head $PUBLISHED): restore extensions/memory-wiki, concurrent reads"
  restore_plugin "$PUBLISHED"; record_tree "$E/before-pr"; cat "$E/before-pr/git-status.txt"
  node --max-old-space-size=8192 --import tsx "$E/harness.mts" concurrent --vault "$V" --query "$QUERY" --out "$E/before-pr/concurrent.json" --label before-pr > "$E/before-pr/concurrent.stdout" 2>&1
  echo "before-pr concurrent exit=$?"; cat "$E/before-pr/concurrent.stdout"

  log "BEFORE (base $BASE): restore extensions/memory-wiki, 10,000-page search"
  restore_plugin "$BASE"; record_tree "$E/before"; cat "$E/before/git-status.txt"
  echo "new modules present after restore? (expect: none)"; ls extensions/memory-wiki/src/query-reader.ts extensions/memory-wiki/src/query-scoring.ts 2>&1
  node --max-old-space-size=8192 --import tsx "$E/harness.mts" search --vault "$V" --query "$QUERY" --out "$E/before/search.json" --label before > "$E/before/search.stdout" 2>&1
  echo "before search exit=$?"; grep -v '^\s*"\(results\|snippet\)' "$E/before/search.stdout" | head -60
  log "compare every result object (base versus new head)"
  compare "$E/before/search.json" "$E/after/search.json" | tee "$E/results-compare.json" | head -12

  log "RED: new head test files against the published head's production code ($PUBLISHED)"
  restore_plugin "$PUBLISHED"
  git checkout HEAD -- extensions/memory-wiki/src/query-scheduling.test.ts extensions/memory-wiki/src/query-reader.test.ts
  git status --short
  pnpm vitest run extensions/memory-wiki/src/query-scheduling.test.ts 2>&1 | strip > "$E/red-scheduling.log"
  echo "red (query-scheduling) vitest exit=${PIPESTATUS[0]}"
  grep -E '✓|×|FAIL|AssertionError|expected|Tests |Test Files|Duration|resolved' "$E/red-scheduling.log" | head -40
  pnpm vitest run extensions/memory-wiki/src/query-reader.test.ts 2>&1 | strip > "$E/red-reader.log"
  echo "red (query-reader) vitest exit=${PIPESTATUS[0]}"
  grep -E '✓|×|FAIL|AssertionError|expected|Tests |Test Files|Duration' "$E/red-reader.log" | head -40

  log "restore HEAD (status must be empty)"
  restore_plugin HEAD; git status --short

  log "GREEN: same test files at the new head"
  pnpm vitest run extensions/memory-wiki/src/query-scheduling.test.ts 2>&1 | strip > "$E/green-scheduling.log"
  echo "green (query-scheduling) vitest exit=${PIPESTATUS[0]}"
  grep -E '✓|×|FAIL|Tests |Test Files|Duration' "$E/green-scheduling.log" | head -40
  pnpm vitest run extensions/memory-wiki/src/query-reader.test.ts 2>&1 | strip > "$E/green-reader.log"
  echo "green (query-reader) vitest exit=${PIPESTATUS[0]}"
  grep -E '✓|×|FAIL|Tests |Test Files|Duration' "$E/green-reader.log" | head -40

  log "HEAD test cost: one untimed warm-up run per file, then the timed run (pnpm test <file> --maxWorkers=1)"
  for f in extensions/memory-wiki/src/query-reader.test.ts extensions/memory-wiki/src/query-scheduling.test.ts extensions/memory-wiki/src/query.reads.test.ts extensions/memory-wiki/src/query.abort.test.ts extensions/memory-wiki/src/tool.deadline.test.ts; do
    pnpm test "$f" --maxWorkers=1 > /dev/null 2>&1
    echo "--- head (warm): $f"
    /usr/bin/time -p pnpm test "$f" --maxWorkers=1 2>&1 | strip | grep -E 'Test Files|Tests |Duration|^real|^user|FAIL|×' | tail -8
  done

  log "git state at end (status must be empty)"
  git rev-parse HEAD; git status --short
  echo "EXIT=0"
} > ~/work/oss-166304-evidence.log 2>&1
cp ~/work/oss-166304-evidence.log "$E/evidence-run.log"
touch ~/work/oss-166304-evidence.done
