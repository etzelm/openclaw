#!/bin/bash
# Evidence for openclaw/openclaw#166433 revision 4 (wiki scans release shared compute
# between bounded batches), one sitting at the new head on the Mac Studio:
#   gates; red/green of the changed test files against the previous head's production code;
#   single-permit contention of a real memory-core retrieval pool with a running wiki scan
#   (previous head versus head, 10,000 and 20,000 pages, two repetitions);
#   the 10,000-page search pair; concurrent exact reads; deadline ownership and on-disk
#   compatibility re-run at the head against the base captures of revision 3; test cost; build.
export PATH="$HOME/homebrew/bin:$PATH"
cd ~/work/oss-166304 || exit 1
E=~/work/oss-166304-r4
R3=~/work/oss-166304-r3-v2
HEAD_SHA=$(git rev-parse HEAD)
BASE=$(git merge-base HEAD upstream/main)
PREV=19353569c95d0e77c33b30bcf7b4c6bb097087cf
QUERY="cobalt lantern ledger harbor"
V10=~/work/oss-166304-vault-10k
VBIG=~/work/oss-166304-vault-big
VC=~/work/oss-166304-vault-compat
SCHED=extensions/memory-wiki/src/query-scheduling.test.ts
CHANGED_TESTS="extensions/memory-wiki/src/query-shared-compute.test.ts extensions/memory-wiki/src/query-scheduling.test.ts extensions/memory-wiki/src/query-reader.test.ts extensions/memory-wiki/src/query.reads.test.ts extensions/memory-wiki/src/query.abort.test.ts"
TEST_SUPPORT=extensions/memory-wiki/src/query-scan.test-support.ts
strip() { sed 's/\x1b\[[0-9;]*m//g'; }
log() { echo; echo "=== $*"; date -u +%Y-%m-%dT%H:%M:%SZ; echo "--- load: $(uptime)"; echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) | $* | $(uptime)" >> "$E/load-during-capture.txt"; }
restore_plugin() { git restore --source="$1" --staged --worktree -- extensions/memory-wiki; }
record_tree() { mkdir -p "$1"; echo "$2" > "$1/plugin-source.txt"; git status --short > "$1/git-status.txt"; }
H() { node --max-old-space-size=8192 --import tsx "$E/harness.mts" "$@"; }
C() { H_ARGS=("$@"); node --max-old-space-size=8192 --require "$E/single-permit.cjs" --import tsx "$E/harness.mts" contention "${H_ARGS[@]}"; }
compare() {
  node -e '
    const fs = require("node:fs");
    const b = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    const a = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
    const before = b.results, after = a.results;
    const differences = [];
    for (let i = 0; i < Math.max(before.length, after.length); i += 1) {
      if (JSON.stringify(before[i]) !== JSON.stringify(after[i])) {
        differences.push({ index: i, before: before[i] ?? null, after: after[i] ?? null });
      }
    }
    console.log(JSON.stringify({
      comparison: "JSON.stringify of every result object, all fields, in order",
      before: process.argv[1].split("/").slice(-3).join("/"), after: process.argv[2].split("/").slice(-3).join("/"),
      beforeCount: before.length, afterCount: after.length,
      identicalResults: JSON.stringify(before) === JSON.stringify(after), differences,
    }, null, 2));
  ' "$1" "$2"
}
tree_hash() { (cd "$1" && find . -type f -print0 | LC_ALL=C sort -z | xargs -0 shasum -a 256); }
tree_hash_ts() { python3 -c '
import hashlib, os, re, sys
root = sys.argv[1]
ts = re.compile(rb"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z")
for d, _, fs in sorted(os.walk(root)):
    for f in sorted(fs):
        p = os.path.join(d, f)
        print(hashlib.sha256(ts.sub(b"<ts>", open(p, "rb").read())).hexdigest() + "  ./" + os.path.relpath(p, root))
' "$1"; }
mkdir -p "$E/red" "$E/budget/head" "$E/compat/head" "$E/after" "$E/cost"
echo "# uptime at the start of every phase (UTC | phase | sample); machine: <host>" > "$E/load-during-capture.txt"
{
  log "git state at start (status must be empty)"
  echo "HEAD=$HEAD_SHA BASE=$BASE PREV=$PREV"; git log --oneline -6; git status --short
  log "machine"
  uname -a | sed "s/$(uname -n)/<host>/"; node --version; sysctl -n machdep.cpu.brand_string hw.ncpu hw.memsize 2>/dev/null

  log "GATES: owning lane pnpm vitest run extensions/memory-wiki/"
  pnpm vitest run extensions/memory-wiki/ 2>&1 | strip > "$E/tests.log"; echo "lane exit=${PIPESTATUS[0]}"; tail -6 "$E/tests.log"
  log "GATES: pnpm check:changed --base upstream/main"
  pnpm check:changed --base upstream/main 2>&1 | strip > "$E/check-changed.log"; echo "check:changed exit=${PIPESTATUS[0]}"; tail -8 "$E/check-changed.log"
  log "GATES: changed:lanes and diff --check"
  pnpm changed:lanes --json --base upstream/main 2>&1 | strip > "$E/changed-lanes.json"; grep -A16 '"lanes"' "$E/changed-lanes.json"
  git diff --check upstream/main HEAD && echo "diff --check clean"

  log "RED: the head's changed test files against the previous head's production code ($PREV)"
  restore_plugin "$PREV"; git checkout HEAD -- $CHANGED_TESTS $TEST_SUPPORT; git status --short
  for f in $CHANGED_TESTS; do
    n=$(basename "$f" .test.ts)
    pnpm vitest run "$f" 2>&1 | strip > "$E/red/red-$n.log"; echo "red $n exit=${PIPESTATUS[0]}"
    grep -E '✓|×|→|Tests |Test Files' "$E/red/red-$n.log"
  done
  restore_plugin HEAD; git status --short
  log "GREEN: the same files at the head"
  for f in $CHANGED_TESTS; do
    n=$(basename "$f" .test.ts)
    pnpm vitest run "$f" 2>&1 | strip > "$E/red/green-$n.log"; echo "green $n exit=${PIPESTATUS[0]}"
    grep -E '✓|×|→|Tests |Test Files' "$E/red/green-$n.log"
  done

  for rep in 1 2; do
    for tree in prev head; do
      sha=$PREV; [ $tree = head ] && sha=$HEAD_SHA
      restore_plugin "$sha"; record_tree "$E/contention/$tree" "$sha"
      log "CONTENTION ($tree $sha) 10k rep $rep"
      C --vault "$V10" --query "$QUERY" --out "$E/contention/$tree/10k-rep$rep.json" --label "$tree" 2>&1 | grep -E '"(limit|scanWallMs|count|p50|p99|max|overMemorySearchDeadline30s|settledBeforeScanEnded|idleRetrievalMs)"'
      log "CONTENTION ($tree $sha) 20k rep $rep"
      C --vault "$VBIG" --query "$QUERY" --out "$E/contention/$tree/20k-rep$rep.json" --label "$tree" 2>&1 | grep -E '"(limit|scanWallMs|count|p50|p99|max|overMemorySearchDeadline30s|settledBeforeScanEnded|idleRetrievalMs)"'
    done
  done
  for size in 10k 20k; do
    compare "$E/contention/prev/$size-rep1.json" "$E/contention/head/$size-rep1.json" > "$E/contention/results-compare-$size.json"; head -6 "$E/contention/results-compare-$size.json"
  done
  restore_plugin HEAD; git status --short

  log "10K SEARCH, default capacity: previous head then head"
  restore_plugin "$PREV"; record_tree "$E/before-r4" "$PREV"
  H search --vault "$V10" --query "$QUERY" --out "$E/before-r4/search.json" --label previous-head > "$E/before-r4/search.stdout" 2>&1; echo "exit=$?"
  restore_plugin HEAD; record_tree "$E/after" "$HEAD_SHA"
  H search --vault "$V10" --query "$QUERY" --out "$E/after/search.json" --label head > "$E/after/search.stdout" 2>&1; echo "exit=$?"
  grep -E '"(searchWallMs|wallMs|eventLoopUtilization|callingThreadCpuMs|resultCount)"' "$E/before-r4/search.stdout" "$E/after/search.stdout" | head -20
  compare "$R3/before/search.json" "$E/after/search.json" > "$E/after/results-compare-base.json"; head -6 "$E/after/results-compare-base.json"
  log "10K CONCURRENT exact reads at the head"
  H concurrent --vault "$V10" --query "$QUERY" --out "$E/after/concurrent.json" --label head > "$E/after/concurrent.stdout" 2>&1; echo "exit=$?"; cat "$E/after/concurrent.stdout"

  log "DEADLINE OWNERSHIP at the head, 20,000 pages (base and pool-timeout cells are revision 3's)"
  for step in cli-search cli-get tool; do
    log "budget head $step"
    H budget --vault "$VBIG" --query "$QUERY" --lookup page-14321 --step $step --out "$E/budget/head/$step.json" --label head > "$E/budget/head/$step.stdout" 2>&1
    echo "exit=$?"; grep -E '"(outcome|wallMs|error|resultCount|path)"' "$E/budget/head/$step.stdout"
  done
  compare "$R3/budget/base/cli-search.json" "$E/budget/head/cli-search.json" > "$E/budget/results-compare.json"; head -6 "$E/budget/results-compare.json"

  log "COMPAT at the head on copies of the base-compiled vault"
  tree_hash "$VC" > "$E/compat/vault-compat-now.sha256"
  diff "$R3/compat/tree-after-base-compile.sha256" "$E/compat/vault-compat-now.sha256" && echo "source vault unchanged since the base compile"
  rm -rf "$VC-r4-head" "$VC-r4-apply-head"; cp -R "$VC" "$VC-r4-head"; cp -R "$VC" "$VC-r4-apply-head"
  for step in cli-search cli-get; do
    H budget --vault "$VC-r4-head" --query "$QUERY" --lookup page-1234 --step $step --out "$E/compat/head/$step.json" --label compat-head > "$E/compat/head/$step.stdout" 2>&1
    echo "head $step exit=$?"; grep -E '"(outcome|wallMs|error|resultCount|path)"' "$E/compat/head/$step.stdout"
  done
  tree_hash "$VC-r4-head" > "$E/compat/tree-after-head-queries.sha256"
  diff "$R3/compat/tree-after-base-compile.sha256" "$E/compat/tree-after-head-queries.sha256" && echo "queries left the tree identical"
  compare "$R3/compat/base/cli-search.json" "$E/compat/head/cli-search.json" > "$E/compat/results-compare.json"; head -6 "$E/compat/results-compare.json"
  H budget --vault "$VC-r4-apply-head" --lookup page-1234 --query unused --step cli-apply --out "$E/compat/head/cli-apply.json" --label compat-head > "$E/compat/head/cli-apply.stdout" 2>&1
  echo "head cli-apply exit=$?"; grep -E '"(outcome|wallMs|error|changed|pagePath)"' "$E/compat/head/cli-apply.stdout"
  tree_hash_ts "$VC-r4-apply-head" > "$E/compat/tree-after-head-apply.ts-normalized.sha256"
  echo "--- update_metadata, timestamps normalized, base (revision 3) versus head:"
  diff "$R3/compat/tree-after-base-apply.ts-normalized.sha256" "$E/compat/tree-after-head-apply.ts-normalized.sha256" | tee "$E/compat/apply-ts-normalized.diff"
  rm -rf "$VC-r4-head" "$VC-r4-apply-head"

  log "TEST COST at the head (pnpm test <file> --maxWorkers=1, warmed once, then timed)"
  for f in $CHANGED_TESTS; do
    pnpm test "$f" --maxWorkers=1 > /dev/null 2>&1
    echo "--- $f"; /usr/bin/time -p pnpm test "$f" --maxWorkers=1 2>&1 | strip | grep -E 'Tests |Duration|^real|FAIL|×' | tail -5
  done
  log "TEST COST: previous head's $SCHED against its own production code"
  restore_plugin "$PREV"; pnpm test "$SCHED" --maxWorkers=1 > /dev/null 2>&1
  /usr/bin/time -p pnpm test "$SCHED" --maxWorkers=1 2>&1 | strip | grep -E 'Tests |Duration|^real|FAIL|×' | tail -5
  restore_plugin HEAD; git status --short

  log "BUILD: standalone plugin build"
  node scripts/lib/plugin-npm-runtime-build.mjs extensions/memory-wiki 2>&1 | strip > "$E/build-standalone.log"; echo "standalone exit=${PIPESTATUS[0]}"
  grep -E "entry:|query-reader.worker|Build complete|built memory-wiki" "$E/build-standalone.log"
  git status --short
  log "DONE"
} > "$E/evidence-run.log" 2>&1
