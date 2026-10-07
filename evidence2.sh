#!/bin/bash
# Evidence phase 2, same sitting: the comparison cells for the head captures of phase 1
# (base main, the single-worker variant, the pool-timeout variant) and the root build.
export PATH="$HOME/homebrew/bin:$PATH"
cd ~/work/oss-166304 || exit 1
E=~/work/oss-166304-r4
HEAD_SHA=$(git rev-parse HEAD)
BASE=$(git merge-base HEAD upstream/main)
FIRST=a5af25c3924b21935856b4ff9f4e0be08d071a89
TIMEOUTV=492827c8100fcb88a9f88e7c565311c798cfa65a
QUERY="cobalt lantern ledger harbor"
V10=~/work/oss-166304-vault-10k
VBIG=~/work/oss-166304-vault-big
VC=~/work/oss-166304-vault-compat
strip() { sed 's/\x1b\[[0-9;]*m//g'; }
log() { echo; echo "=== $*"; date -u +%Y-%m-%dT%H:%M:%SZ; echo "--- load: $(uptime)"; echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) | $* | $(uptime)" >> "$E/load-during-capture.txt"; }
restore_plugin() { git restore --source="$1" --staged --worktree -- extensions/memory-wiki; }
record_tree() { mkdir -p "$1"; echo "$2" > "$1/plugin-source.txt"; git status --short > "$1/git-status.txt"; }
H() { node --max-old-space-size=8192 --import tsx "$E/harness.mts" "$@"; }
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
mkdir -p "$E/before" "$E/before-pr" "$E/budget/base" "$E/budget/pool-timeout" "$E/compat/base"
{
  log "phase 2 start; HEAD=$HEAD_SHA BASE=$BASE"
  git status --short
  log "CONTENTION on base main (the scan runs on the calling thread and takes no permit)"
  restore_plugin "$BASE"; record_tree "$E/contention/base" "$BASE"
  for size in 10k 20k; do
    v=$V10; [ $size = 20k ] && v=$VBIG
    log "CONTENTION (base) $size"
    node --max-old-space-size=8192 --require "$E/single-permit.cjs" --import tsx "$E/harness.mts" contention --vault "$v" --query "$QUERY" --out "$E/contention/base/$size-rep1.json" --label base 2>&1 | grep -E '"(limit|scanWallMs|count|p50|p99|max|overMemorySearchDeadline30s|settledBeforeScanEnded|idleRetrievalMs)"'
    compare "$E/contention/base/$size-rep1.json" "$E/contention/head/$size-rep1.json" > "$E/contention/results-compare-base-head-$size.json"; head -6 "$E/contention/results-compare-base-head-$size.json"
  done
  log "10K SEARCH BEFORE (base main)"
  restore_plugin "$BASE"; record_tree "$E/before" "$BASE"
  H search --vault "$V10" --query "$QUERY" --out "$E/before/search.json" --label base > "$E/before/search.stdout" 2>&1; echo "exit=$?"
  compare "$E/before/search.json" "$E/after/search.json" > "$E/results-compare.json"; head -6 "$E/results-compare.json"
  log "10K CONCURRENT BEFORE-PR (single-worker variant $FIRST)"
  restore_plugin "$FIRST"; record_tree "$E/before-pr" "$FIRST"
  H concurrent --vault "$V10" --query "$QUERY" --out "$E/before-pr/concurrent.json" --label before-pr > "$E/before-pr/concurrent.stdout" 2>&1; echo "exit=$?"; cat "$E/before-pr/concurrent.stdout"

  for tree in base pool-timeout; do
    sha=$BASE; [ $tree = pool-timeout ] && sha=$TIMEOUTV
    restore_plugin "$sha"; record_tree "$E/budget/$tree" "$sha"
    for step in cli-search cli-get tool; do
      log "budget $tree $step"
      H budget --vault "$VBIG" --query "$QUERY" --lookup page-14321 --step $step --out "$E/budget/$tree/$step.json" --label $tree > "$E/budget/$tree/$step.stdout" 2>&1
      echo "exit=$?"; grep -E '"(outcome|wallMs|error|resultCount|path)"' "$E/budget/$tree/$step.stdout"
    done
  done
  compare "$E/budget/base/cli-search.json" "$E/budget/head/cli-search.json" > "$E/budget/results-compare.json"; head -6 "$E/budget/results-compare.json"

  log "COMPAT base on copies of the base-compiled vault"
  restore_plugin "$BASE"; record_tree "$E/compat/base" "$BASE"
  rm -rf "$VC-r4-base" "$VC-r4-apply-base"; cp -R "$VC" "$VC-r4-base"; cp -R "$VC" "$VC-r4-apply-base"
  for step in cli-search cli-get; do
    H budget --vault "$VC-r4-base" --query "$QUERY" --lookup page-1234 --step $step --out "$E/compat/base/$step.json" --label compat-base > "$E/compat/base/$step.stdout" 2>&1
    echo "base $step exit=$?"; grep -E '"(outcome|wallMs|error|resultCount|path)"' "$E/compat/base/$step.stdout"
  done
  tree_hash "$VC-r4-base" > "$E/compat/tree-after-base-queries.sha256"
  diff "$E/compat/vault-compat-now.sha256" "$E/compat/tree-after-base-queries.sha256" && echo "base queries left the tree identical"
  diff "$E/compat/vault-compat-now.sha256" "$E/compat/tree-after-head-queries.sha256" && echo "head queries left the tree identical"
  compare "$E/compat/base/cli-search.json" "$E/compat/head/cli-search.json" > "$E/compat/results-compare.json"; head -6 "$E/compat/results-compare.json"
  H budget --vault "$VC-r4-apply-base" --lookup page-1234 --query unused --step cli-apply --out "$E/compat/base/cli-apply.json" --label compat-base > "$E/compat/base/cli-apply.stdout" 2>&1
  echo "base cli-apply exit=$?"; grep -E '"(outcome|wallMs|error|changed|pagePath)"' "$E/compat/base/cli-apply.stdout"
  tree_hash_ts "$VC-r4-apply-base" > "$E/compat/tree-after-base-apply.ts-normalized.sha256"
  echo "--- update_metadata, timestamps normalized, base versus head (same sitting):"
  diff "$E/compat/tree-after-base-apply.ts-normalized.sha256" "$E/compat/tree-after-head-apply.ts-normalized.sha256" | tee "$E/compat/apply-ts-normalized.diff"
  rm -rf "$VC-r4-base" "$VC-r4-apply-base"
  git diff --stat "$BASE" "$HEAD_SHA" -- extensions/memory-wiki/src/compiled-cache.ts extensions/memory-wiki/src/compile.ts extensions/memory-wiki/src/vault.ts extensions/memory-wiki/src/markdown.ts extensions/memory-wiki/src/log.ts extensions/memory-wiki/src/source-sync-state.ts extensions/memory-wiki/src/import-runs-state.ts extensions/memory-wiki/src/vault-page-write.ts extensions/memory-wiki/openclaw.plugin.json | tee "$E/compat/persisted-modules-diffstat.txt"; echo "(empty above means no change)"
  restore_plugin "$HEAD_SHA"; git status --short

  log "BUILD: root bundled build (pnpm build)"
  pnpm build > "$E/build.log" 2>&1; echo "pnpm build exit=$?"
  grep -E "^\[build-all\] phase timings" "$E/build.log" | strip
  ls -l dist/extensions/memory-wiki/src/query-reader.worker.js
  echo "--- worker imports"; grep -oE 'from "[^"]+"' dist/extensions/memory-wiki/src/query-reader.worker.js
  git status --short
  log "PHASE 2 DONE"
} > "$E/evidence2-run.log" 2>&1
