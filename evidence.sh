#!/bin/bash
# Evidence for openclaw/openclaw#166433 revision 3 (deadlines stay with the caller;
# deterministic scheduling tests), one sitting at the new head on the Mac Studio.
#   gates; red/green of query-scheduling.test.ts against the first draft and the previous head;
#   repeated runs of the new and the previous scheduling test file under CPU contention;
#   deadline ownership on a vault whose scan exceeds 30 s (base, previous head, head);
#   the 10,000-page search and concurrent-read pairs; on-disk compatibility; test cost; builds.
export PATH="$HOME/homebrew/bin:$PATH"
cd ~/work/oss-166304 || exit 1
E=~/work/oss-166304-r3
BASE=$(git merge-base HEAD upstream/main)
PREV=492827c8100fcb88a9f88e7c565311c798cfa65a
FIRST=a5af25c3924b21935856b4ff9f4e0be08d071a89
QUERY="cobalt lantern ledger harbor"
VBIG=~/work/oss-166304-vault-big
V10=~/work/oss-166304-vault-10k
VC=~/work/oss-166304-vault-compat
SCHED=extensions/memory-wiki/src/query-scheduling.test.ts
strip() { sed 's/\x1b\[[0-9;]*m//g'; }
log() { echo; echo "=== $*"; date -u +%Y-%m-%dT%H:%M:%SZ; echo "--- load: $(uptime)"; echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) | $* | $(uptime)" >> "$E/load-during-capture.txt"; }
restore_plugin() { git restore --source="$1" --staged --worktree -- extensions/memory-wiki; }
record_tree() { mkdir -p "$1"; git rev-parse HEAD > "$1/git-head.txt"; git status --short > "$1/git-status.txt"; }
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
      before: process.argv[1].split("/").slice(-2).join("/"), after: process.argv[2].split("/").slice(-2).join("/"),
      beforeCount: before.length, afterCount: after.length,
      identicalResults: JSON.stringify(before) === JSON.stringify(after), differences,
      fieldsPerResult: [...new Set(before.flatMap((r) => Object.keys(r)))],
    }, null, 2));
  ' "$1" "$2"
}
tree_hash() { (cd "$1" && find . -type f -print0 | LC_ALL=C sort -z | xargs -0 shasum -a 256); }
# Same, with every ISO-8601 timestamp replaced by <ts> before hashing (update_metadata stamps updatedAt).
tree_hash_ts() { python3 -c '
import hashlib, os, re, sys
root = sys.argv[1]
ts = re.compile(rb"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z")
for d, _, fs in sorted(os.walk(root)):
    for f in sorted(fs):
        p = os.path.join(d, f)
        print(hashlib.sha256(ts.sub(b"<ts>", open(p, "rb").read())).hexdigest() + "  ./" + os.path.relpath(p, root))
' "$1"; }
burn_start() { BURN=(); for i in $(seq "$1"); do nice -n 5 node -e 'for(;;){}' & BURN+=($!); done; }
burn_stop() { [ ${#BURN[@]} -gt 0 ] && kill "${BURN[@]}" 2>/dev/null; wait "${BURN[@]}" 2>/dev/null; BURN=(); }
BURN=(); trap burn_stop EXIT; trap "burn_stop; exit 143" TERM INT
repeat_sched() {
  local label=$1 runs=$2 pass=0 fail=0
  for i in $(seq "$runs"); do
    if pnpm vitest run "$SCHED" > "$E/repeat/$label-run.log" 2>&1; then pass=$((pass+1)); else fail=$((fail+1)); cp "$E/repeat/$label-run.log" "$E/repeat/$label-fail-$i.log"; fi
  done
  rm -f "$E/repeat/$label-run.log"
  echo "$label: runs=$runs passed=$pass failed=$fail" | tee -a "$E/repeat/summary.txt"
}
mkdir -p "$E/repeat" "$E/budget/cli-built" "$E/after" "$E/before" "$E/before-pr" "$E/compat"
echo "# uptime at the start of every phase (UTC | phase | sample); machine: <host>" > "$E/load-during-capture.txt"
{
  log "git state at start (status must be empty)"
  echo "HEAD=$(git rev-parse HEAD) BASE=$BASE PREV=$PREV FIRST=$FIRST"; git log --oneline -5; git status --short
  log "machine"
  uname -a | sed "s/$(uname -n)/<host>/"; node --version; sysctl -n machdep.cpu.brand_string hw.ncpu hw.memsize 2>/dev/null
  echo "--- top CPU consumers"; ps -Ao pcpu,etime,comm -r | head -6

  log "GATES: owning lane pnpm vitest run extensions/memory-wiki/"
  pnpm vitest run extensions/memory-wiki/ 2>&1 | strip > "$E/tests.log"; echo "lane exit=${PIPESTATUS[0]}"; tail -6 "$E/tests.log"
  log "GATES: pnpm check:changed --base upstream/main"
  pnpm check:changed --base upstream/main 2>&1 | strip > "$E/check-changed.log"; echo "check:changed exit=${PIPESTATUS[0]}"; tail -8 "$E/check-changed.log"
  log "GATES: changed:lanes and diff --check"
  pnpm changed:lanes --json --base upstream/main 2>&1 | strip > "$E/changed-lanes.json"; cat "$E/changed-lanes.json"
  git diff --check upstream/main HEAD && echo "diff --check clean"

  log "RED A: head $SCHED against the first draft's production code ($FIRST)"
  restore_plugin "$FIRST"; git checkout HEAD -- "$SCHED"; git status --short
  pnpm vitest run "$SCHED" 2>&1 | strip > "$E/red-first-draft-scheduling.log"; echo "red A exit=${PIPESTATUS[0]}"
  grep -E '✓|×|→|Tests |Test Files' "$E/red-first-draft-scheduling.log"
  log "RED B: head $SCHED against the previous head's production code ($PREV)"
  restore_plugin "$PREV"; git checkout HEAD -- "$SCHED"; git status --short
  pnpm vitest run "$SCHED" 2>&1 | strip > "$E/red-previous-head-scheduling.log"; echo "red B exit=${PIPESTATUS[0]}"
  grep -E '✓|×|→|Tests |Test Files' "$E/red-previous-head-scheduling.log"
  restore_plugin HEAD; git status --short
  log "GREEN: $SCHED at the head"
  pnpm vitest run "$SCHED" 2>&1 | strip > "$E/green-scheduling.log"; echo "green exit=${PIPESTATUS[0]}"
  grep -E '✓|×|→|Tests |Test Files' "$E/green-scheduling.log"

  log "REPEAT: $SCHED 30 times at the head, then the previous head's file and production 30 times, both under 28 busy-loop processes (nice 5)"
  : > "$E/repeat/summary.txt"
  burn_start 28; sleep 2; echo "--- load with burners: $(uptime)"
  repeat_sched head 30
  restore_plugin "$PREV"; git status --short
  repeat_sched previous-head 30
  restore_plugin HEAD; git status --short
  burn_stop; echo "--- load after burners: $(uptime)"
  ls "$E/repeat"

  log "BUDGET: generate a 20,000-page vault (120 body lines, 60 claims per page) whose whole-vault scan exceeds 30 s"
  rm -rf "$VBIG"; H generate --vault "$VBIG" --pages 20000 --lines 120 --claims 60 | tee "$E/budget/vault-generate.json"; du -sh "$VBIG"
  for tree in head previous-head base; do
    case $tree in head) restore_plugin HEAD;; previous-head) restore_plugin "$PREV";; base) restore_plugin "$BASE";; esac
    record_tree "$E/budget/$tree"; echo "--- tree $tree"; cat "$E/budget/$tree/git-status.txt"
    for step in cli-search cli-get tool; do
      log "BUDGET $tree $step"
      H budget --vault "$VBIG" --query "$QUERY" --lookup page-14321 --step $step --out "$E/budget/$tree/$step.json" --label $tree > "$E/budget/$tree/$step.stdout" 2>&1
      echo "exit=$?"; grep -E '"(outcome|wallMs|error|resultCount|path)"' "$E/budget/$tree/$step.stdout"
    done
  done
  restore_plugin HEAD; git status --short
  log "BUDGET compare: cli-search results base versus head"
  compare "$E/budget/base/cli-search.json" "$E/budget/head/cli-search.json" | tee "$E/budget/results-compare.json" | head -12

  log "10K: generate the 10,000-page vault (60 body lines, 30 claims per page)"
  rm -rf "$V10"; H generate --vault "$V10" --pages 10000 --lines 60 --claims 30 | tee "$E/vault-generate.json"; du -sh "$V10"
  log "10K AFTER (head): search"
  record_tree "$E/after"
  H search --vault "$V10" --query "$QUERY" --out "$E/after/search.json" --label after > "$E/after/search.stdout" 2>&1; echo "exit=$?"
  log "10K AFTER (head): concurrent exact-path reads during a scan"
  H concurrent --vault "$V10" --query "$QUERY" --out "$E/after/concurrent.json" --label after > "$E/after/concurrent.stdout" 2>&1; echo "exit=$?"; cat "$E/after/concurrent.stdout"
  log "10K BEFORE-PR (first draft $FIRST): concurrent"
  restore_plugin "$FIRST"; record_tree "$E/before-pr"; cat "$E/before-pr/git-status.txt"
  H concurrent --vault "$V10" --query "$QUERY" --out "$E/before-pr/concurrent.json" --label before-pr > "$E/before-pr/concurrent.stdout" 2>&1; echo "exit=$?"; cat "$E/before-pr/concurrent.stdout"
  log "10K BEFORE (base $BASE): search"
  restore_plugin "$BASE"; record_tree "$E/before"; cat "$E/before/git-status.txt"
  ls extensions/memory-wiki/src/query-reader.ts 2>&1
  H search --vault "$V10" --query "$QUERY" --out "$E/before/search.json" --label before > "$E/before/search.stdout" 2>&1; echo "exit=$?"
  restore_plugin HEAD; git status --short
  log "10K compare"
  compare "$E/before/search.json" "$E/after/search.json" | tee "$E/results-compare.json" | head -12
  for f in before/search after/search; do node -e 'const r=require(process.argv[1]); console.log(process.argv[2], JSON.stringify({searchWallMs:r.searchWallMs, elu:r.eventLoopUtilization, mainThreadCpuMs:r.mainThreadCpuMs, delay:r.eventLoopDelayMs, probe:r.probe, memoryMb:r.memoryMb}))' "$E/$f.json" "$f"; done

  log "COMPAT: a vault initialized and compiled by base code, then queried by base and by head: on-disk tree hash and results"
  rm -rf "$VC" "$VC-base" "$VC-head" "$VC-apply-base" "$VC-apply-head"
  H generate --vault "$VC" --pages 2000 --lines 40 --claims 20 | tee "$E/compat/vault-generate.json"
  restore_plugin "$BASE"
  H search --vault "$VC" --query "$QUERY" --compile yes --out "$E/compat/base-compile-search.json" --label base-compile > "$E/compat/base-compile-search.stdout" 2>&1; echo "base compile+search exit=$?"
  cp -R "$VC" "$VC-base"; cp -R "$VC" "$VC-head"; cp -R "$VC" "$VC-apply-base"; cp -R "$VC" "$VC-apply-head"
  tree_hash "$VC" > "$E/compat/tree-after-base-compile.sha256"; wc -l < "$E/compat/tree-after-base-compile.sha256"
  for tree in base head; do
    case $tree in head) restore_plugin HEAD;; base) restore_plugin "$BASE";; esac
    record_tree "$E/compat/$tree"
    for step in cli-search cli-get; do
      H budget --vault "$VC-$tree" --query "$QUERY" --lookup page-1234 --step $step --out "$E/compat/$tree/$step.json" --label compat-$tree > "$E/compat/$tree/$step.stdout" 2>&1
      echo "$tree $step exit=$?"; grep -E '"(outcome|wallMs|error|resultCount|path)"' "$E/compat/$tree/$step.stdout"
    done
    tree_hash "$VC-$tree" > "$E/compat/tree-after-$tree-queries.sha256"
  done
  for tree in base head; do
    case $tree in head) restore_plugin HEAD;; base) restore_plugin "$BASE";; esac
    H budget --vault "$VC-apply-$tree" --lookup page-1234 --query unused --step cli-apply --out "$E/compat/$tree/cli-apply.json" --label compat-$tree > "$E/compat/$tree/cli-apply.stdout" 2>&1
    echo "$tree cli-apply exit=$?"; grep -E '"(outcome|wallMs|error|changed|pagePath)"' "$E/compat/$tree/cli-apply.stdout"
    tree_hash "$VC-apply-$tree" > "$E/compat/tree-after-$tree-apply.sha256"
    tree_hash_ts "$VC-apply-$tree" > "$E/compat/tree-after-$tree-apply.ts-normalized.sha256"
  done
  restore_plugin HEAD; git status --short
  echo "--- update_metadata: files whose raw bytes differ between the base-applied and head-applied copies:"
  diff "$E/compat/tree-after-base-apply.sha256" "$E/compat/tree-after-head-apply.sha256" | grep '^[<>]' | awk '{print $3}' | sort -u | tee "$E/compat/apply-raw-differing-files.txt"
  echo "($(wc -l < "$E/compat/apply-raw-differing-files.txt") files)"
  echo "--- update_metadata: the same comparison with ISO-8601 timestamps normalized:"; diff "$E/compat/tree-after-base-apply.ts-normalized.sha256" "$E/compat/tree-after-head-apply.ts-normalized.sha256" && echo identical
  echo "--- tree diff after base compile vs after base queries:"; diff "$E/compat/tree-after-base-compile.sha256" "$E/compat/tree-after-base-queries.sha256" && echo identical
  echo "--- tree diff after base compile vs after head queries:"; diff "$E/compat/tree-after-base-compile.sha256" "$E/compat/tree-after-head-queries.sha256" && echo identical
  compare "$E/compat/base/cli-search.json" "$E/compat/head/cli-search.json" | tee "$E/compat/results-compare.json" | head -8
  echo "--- persisted-format modules changed between base and head (expect none):"
  git diff --stat "$BASE" HEAD -- extensions/memory-wiki/src/compiled-cache.ts extensions/memory-wiki/src/compile.ts extensions/memory-wiki/src/vault.ts extensions/memory-wiki/src/markdown.ts extensions/memory-wiki/src/log.ts extensions/memory-wiki/src/source-sync-state.ts extensions/memory-wiki/src/import-runs-state.ts extensions/memory-wiki/src/vault-page-write.ts extensions/memory-wiki/openclaw.plugin.json | tee "$E/compat/persisted-modules-diffstat.txt"
  echo "(end of diffstat)"
  git diff "$BASE" HEAD -- extensions/memory-wiki/package.json | tee "$E/compat/package-json.diff"

  log "TEST COST: $SCHED, head file versus previous head file (each warmed once, then timed; pnpm test <file> --maxWorkers=1)"
  pnpm test "$SCHED" --maxWorkers=1 > /dev/null 2>&1
  echo "--- head (warm)"; /usr/bin/time -p pnpm test "$SCHED" --maxWorkers=1 2>&1 | strip | grep -E 'Test Files|Tests |Duration|^real|^user|FAIL|×' | tail -8
  restore_plugin "$PREV"; git status --short
  pnpm test "$SCHED" --maxWorkers=1 > /dev/null 2>&1
  echo "--- previous head (warm)"; /usr/bin/time -p pnpm test "$SCHED" --maxWorkers=1 2>&1 | strip | grep -E 'Test Files|Tests |Duration|^real|^user|FAIL|×' | tail -8
  restore_plugin HEAD; git status --short

  log "BUILD: standalone plugin build"
  node scripts/lib/plugin-npm-runtime-build.mjs extensions/memory-wiki 2>&1 | strip | tee "$E/build-standalone.log"; echo "standalone exit=${PIPESTATUS[0]}"
  find extensions/memory-wiki/dist -name '*worker*' -exec ls -la {} \;
  git status --short
  log "BUILD: root bundled build (pnpm build)"
  pnpm build 2>&1 | strip > "$E/build.log"; echo "pnpm build exit=${PIPESTATUS[0]}"; grep -E '^\[build-all\] phase timings' "$E/build.log"
  find dist/extensions/memory-wiki -name '*worker*' -exec ls -la {} \;
  echo "--- worker imports"; grep -o 'from "[^"]*"' dist/extensions/memory-wiki/src/query-reader.worker.js | head -10
  git status --short

  log "CLI: built openclaw wiki search and wiki get against the 20,000-page vault (no gateway, temporary state dir)"
  T=$(mktemp -d); mkdir -p "$T/state"
  cat > "$T/openclaw.json" <<JSON
{ "plugins": { "entries": { "memory-wiki": { "enabled": true, "config": { "vault": { "path": "$VBIG" }, "search": { "backend": "local", "corpus": "wiki" } } } } } }
JSON
  ( export OPENCLAW_CONFIG_PATH="$T/openclaw.json" OPENCLAW_STATE_DIR="$T/state"
    /usr/bin/time -p node openclaw.mjs wiki search "$QUERY" --max-results 10 --json > "$E/budget/cli-built/search.json" 2> "$E/budget/cli-built/search.stderr"; echo "wiki search exit=$?"
    tail -4 "$E/budget/cli-built/search.stderr"; node -e 'try{const r=require(process.argv[1]);console.log("results:",r.length, r.map(x=>x.path).join(" "))}catch(e){console.log("unparsed:",e.message)}' "$E/budget/cli-built/search.json"
    /usr/bin/time -p node openclaw.mjs wiki get page-14321 --lines 3 > "$E/budget/cli-built/get.txt" 2> "$E/budget/cli-built/get.stderr"; echo "wiki get exit=$?"
    tail -4 "$E/budget/cli-built/get.stderr"; head -5 "$E/budget/cli-built/get.txt" )
  log "CLI: 90 s V8 tick profile of the built wiki search on the 20,000-page vault, then the built search on the 2,000-page vault"
  mkdir -p "$T/prof" "$E/budget/cli-built"
  ( cd "$T/prof" && export OPENCLAW_CONFIG_PATH="$T/openclaw.json" OPENCLAW_STATE_DIR="$T/state"
    node --prof ~/work/oss-166304/openclaw.mjs wiki search "$QUERY" --max-results 3 --json > /dev/null 2>&1 & P=$!
    sleep 90; kill -9 $P; wait $P 2>/dev/null
    L=$(ls -S isolate-*.log | head -1); echo "main isolate log: $L ($(ls isolate-*.log | wc -l) isolate logs)"
    node --prof-process "$L" > "$T/prof/main.txt" 2>/dev/null
    { echo "# node --prof-process of the main isolate (largest tick log), built openclaw wiki search on the 20,000-page vault, killed after 90 s"; sed -n '1,30p' "$T/prof/main.txt"; awk '/Bottom up/{f=1} f' "$T/prof/main.txt" | sed -n '1,40p'; } > "$E/budget/cli-built/main-isolate-profile.txt" )
  head -12 "$E/budget/cli-built/main-isolate-profile.txt"
  echo "--- readPageSummaries in the built presentation chunk (compare with the anonymous presentation frame line in the profile):"; grep -n "^async function readPageSummaries" dist/presentation-*.mjs
  cat > "$T/small.json" <<JSON
{ "plugins": { "entries": { "memory-wiki": { "enabled": true, "config": { "vault": { "path": "$VC-head" }, "search": { "backend": "local", "corpus": "wiki" } } } } } }
JSON
  ( export OPENCLAW_CONFIG_PATH="$T/small.json" OPENCLAW_STATE_DIR="$T/state"
    /usr/bin/time -p node openclaw.mjs wiki search "$QUERY" --max-results 3 --json > "$E/budget/cli-built/small-vault-search.json" 2> "$E/budget/cli-built/small-vault-search.stderr"; echo "small wiki search exit=$?"
    tail -3 "$E/budget/cli-built/small-vault-search.stderr"; node -e 'const r=require(process.argv[1]);console.log("results:",r.length, r.map(x=>x.path).join(" "))' "$E/budget/cli-built/small-vault-search.json" )
  rm -rf "$T"

  log "git state at end (status must be empty)"
  git rev-parse HEAD; git status --short
  echo "EXIT=0"
} > ~/work/oss-166304-r3.log 2>&1
cp ~/work/oss-166304-r3.log "$E/evidence-run.log"
cp "$0" "$E/evidence.sh"
touch ~/work/oss-166304-r3.done
