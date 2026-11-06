#!/bin/bash
# Native proof for the p3 lane (static preview regexes) on a GitHub-hosted macOS runner with Xcode.
# Usage: rig/run-lane.sh <prepare|focused|build|workload|summary|trace> [samples]
# Each phase is its own workflow step with its own timeout; state lives under $RUNNER_TEMP.
set -uo pipefail
PHASE="$1"
SAMPLES="${2:-5}"
LANE=p3
RIG="$(cd "$(dirname "$0")" && pwd)"
WORK="${RUNNER_TEMP:-/tmp}/chatui-proof"
OUT="${PROOF_OUT:-$WORK/out}/$LANE"
LOG="$OUT/logs"
mkdir -p "$WORK" "$OUT" "$LOG"
KIT=apps/shared/OpenClawKit
FLAGS=(--disable-index-store -Xswiftc -gline-tables-only)
REL=(-c release -Xswiftc -enable-testing --disable-index-store)

field() { python3 -I -c 'import json,sys; print(json.load(open(sys.argv[1]))[sys.argv[2]][sys.argv[3]])' "$RIG/lanes.json" "$LANE" "$1"; }
BASE="$(field base)"
HEAD="$(field head)"
HEAD_TREE="$(field headTree)"
FOCUS="$(field focus)"
step() { echo "::group::$*"; echo "=== $(date -u +%H:%M:%S) $*"; }
endstep() { echo "::endgroup::"; }
fail() { echo "::error::$*"; echo "FAILED: $*" >>"$OUT/status.txt"; }
# Hard per-command limit (macOS has no coreutils timeout).
limit() { local seconds="$1"; shift; perl -e 'alarm shift; exec @ARGV' "$seconds" "$@"; }

prepare() {
  step "source: base $BASE, head $HEAD"
  local src="$WORK/src"
  rm -rf "$src"
  git init -q "$src"
  git -C "$src" fetch -q --depth 1 https://github.com/openclaw/openclaw.git "$BASE" || { fail "fetch base"; exit 1; }
  git -C "$src" checkout -q --detach FETCH_HEAD
  test "$(git -C "$src" rev-parse HEAD)" = "$BASE" || { fail "base sha mismatch"; exit 1; }
  git -C "$src" apply --index "$RIG/lanes/$LANE.diff" || { fail "head diff does not apply"; exit 1; }
  local tree
  tree="$(git -C "$src" write-tree)"
  echo "head tree $tree (expected $HEAD_TREE)" | tee "$OUT/tree-check.txt"
  test "$tree" = "$HEAD_TREE" || { fail "head tree mismatch"; exit 1; }
  git -C "$src" diff --cached --stat | tee -a "$OUT/tree-check.txt"
  git -C "$src" -c user.name=proof -c user.email=proof@invalid commit -q -m "head $HEAD"
  git -C "$src" worktree add -q --detach "$WORK/base" "$BASE"
  git -C "$src" worktree add -q --detach "$WORK/head" "$(git -C "$src" rev-parse HEAD)"
  endstep

  step "toolchain"
  {
    echo "runner image: ${ImageOS:-unknown} ${ImageVersion:-unknown}"
    xcodebuild -version
    xcode-select -p
    swift --version 2>&1
    sw_vers
    sysctl -n machdep.cpu.brand_string hw.ncpu hw.memsize
    echo "base=$BASE head=$HEAD headTree=$HEAD_TREE"
  } | tee "$OUT/environment.txt"
  endstep

  for side in base head; do
    step "$side: native asset dependencies and Mermaid assets"
    (
      cd "$WORK/$side" || exit 1
      pnpm install --frozen-lockfile --prefer-offline --optional \
        --filter '@openclaw/mermaid-renderer...' --filter '@openclaw/gateway-protocol...' \
        --config.ignore-scripts=false --config.engine-strict=false \
        --config.enable-pre-post-scripts=true >"$LOG/$side-pnpm.log" 2>&1 &&
        node scripts/prepare-apple-mermaid.mjs >"$LOG/$side-mermaid.log" 2>&1
    ) || { tail -40 "$LOG/$side-pnpm.log" "$LOG/$side-mermaid.log"; fail "$side assets"; exit 1; }
    endstep
  done
}

focused() {
  for side in base head; do
    step "$side: focused suites on unmodified code ($FOCUS)"
    if limit 1500 swift build --package-path "$WORK/$side/$KIT" --scratch-path "$WORK/scratch-$side-debug" \
      "${FLAGS[@]}" --build-tests >"$LOG/$side-build-debug.log" 2>&1; then
      limit 600 swift test --package-path "$WORK/$side/$KIT" --scratch-path "$WORK/scratch-$side-debug" "${FLAGS[@]}" \
        --skip-build --filter "$FOCUS" >"$LOG/$side-focused.log" 2>&1 || fail "$side focused suites"
      grep -E "Test run with" "$LOG/$side-focused.log" | tee "$OUT/$side-focused.txt"
    else
      grep -E "error:" "$LOG/$side-build-debug.log" | head -20
      fail "$side debug build"
    fi
    rm -rf "$WORK/scratch-$side-debug"
    endstep
  done
}

build() {
  for side in base head; do
    step "$side: instrument and build release workload"
    python3 -I "$RIG/instrument.py" "$WORK/$side/$KIT/Sources/OpenClawChatUI" "$RIG/ChatPerfProbe.swift" |
      tee "$OUT/$side-probes.txt"
    cp "$RIG/ChatPerfProofWorkload.swift" "$WORK/$side/$KIT/Tests/OpenClawKitTests/"
    git -C "$WORK/$side" add -N "$KIT" && git -C "$WORK/$side" diff -- "$KIT/Sources" \
      "$KIT/Tests/OpenClawKitTests/ChatPerfProofWorkload.swift" >"$OUT/$side-instrumentation.diff"
    # Other suites call DEBUG-only hooks, so the release workload build keeps only the workload test.
    find "$WORK/$side/$KIT/Tests/OpenClawKitTests" -maxdepth 1 -name '*.swift' ! -name ChatPerfProofWorkload.swift -delete
    for dir in "$WORK/$side/$KIT"/Tests/*/; do
      [ "$(basename "$dir")" = OpenClawKitTests ] && continue
      find "$dir" -name '*.swift' -delete
      echo "// Parked for the release workload build." >"$dir/Parked.swift"
    done
    limit 1500 swift build --package-path "$WORK/$side/$KIT" --scratch-path "$WORK/scratch-$side-rel" "${REL[@]}" \
      --build-tests >"$LOG/$side-build-release.log" 2>&1 ||
      { grep -E "error:" "$LOG/$side-build-release.log" | head -20; fail "$side release build"; exit 1; }
    endstep
  done
  # Probe placement must be identical apart from line numbers.
  diff <(sed -E 's/:[0-9]+//g' "$OUT/base-probes.txt") <(sed -E 's/:[0-9]+//g' "$OUT/head-probes.txt") ||
    { fail "probe sets differ"; exit 1; }
  # Instrumentation must differ only where the PR differs.
  diff <(grep '^+' "$OUT/base-instrumentation.diff" | grep -v '^+++') \
    <(grep '^+' "$OUT/head-instrumentation.diff" | grep -v '^+++') && echo "instrumentation identical on both sides"
}

run_workload() {
  local side="$1" sample="$2"
  CHAT_PERF_PROOF=1 CHAT_PERF_OUT="$OUT/samples" CHAT_PERF_LABEL="$side" CHAT_PERF_SAMPLE="$sample" \
    limit 300 swift test --package-path "$WORK/$side/$KIT" --scratch-path "$WORK/scratch-$side-rel" "${REL[@]}" \
    --skip-build --filter ChatPerfProofWorkload >"$LOG/$side-workload-$sample.log" 2>&1 ||
    { tail -30 "$LOG/$side-workload-$sample.log"; fail "$side workload sample $sample"; return 1; }
  grep -E "CHAT_PERF_PROOF|Test run with" "$LOG/$side-workload-$sample.log"
}

workload() {
  step "workload ABAB x$SAMPLES"
  mkdir -p "$OUT/samples"
  uptime | tee "$OUT/load-before.txt"
  for i in $(seq 1 "$SAMPLES"); do
    run_workload base "$i"
    run_workload head "$i"
  done
  uptime | tee "$OUT/load-after.txt"
  endstep
}

summary() {
  step "summary"
  python3 -I "$RIG/summarize.py" "$LANE" "$OUT" "$(field title)" >"$OUT/summary.md" || fail "summary"
  cat "$OUT/summary.md"
  [ -n "${GITHUB_STEP_SUMMARY:-}" ] && cat "$OUT/summary.md" >>"$GITHUB_STEP_SUMMARY"
  endstep
}

# Optional: os_signpost only (no Time Profiler; recording every process stalled on stop before).
trace() {
  for side in base head; do
    step "$side: os_signpost trace"
    local trace="$WORK/$side.trace"
    rm -rf "$trace"
    limit 240 xcrun xctrace record --instrument os_signpost --all-processes --time-limit 90s \
      --output "$trace" >"$LOG/$side-xctrace.log" 2>&1 &
    local xpid=$!
    sleep 6
    run_workload "$side" trace
    wait "$xpid"
    tail -5 "$LOG/$side-xctrace.log"
    if [ -d "$trace" ]; then
      for schema in os-signpost-interval os-signpost; do
        limit 180 xcrun xctrace export --input "$trace" \
          --xpath "/trace-toc/run[@number=\"1\"]/data/table[@schema=\"$schema\"]" \
          >"$WORK/$side-$schema.xml" 2>>"$LOG/$side-export.log" || true
      done
      python3 -I "$RIG/signposts.py" "$side" "$WORK/$side-os-signpost-interval.xml" "$WORK/$side-os-signpost.xml" \
        >"$OUT/$side-signposts.json" 2>>"$LOG/$side-export.log" || echo "$side: no signposts exported"
    else
      echo "$side: trace not recorded"
    fi
    endstep
  done
}

case "$PHASE" in
  prepare | focused | build | workload | summary | trace) "$PHASE" ;;
  *) echo "unknown phase $PHASE"; exit 2 ;;
esac

if [ "$PHASE" = summary ] && [ -s "$OUT/status.txt" ]; then
  cat "$OUT/status.txt"
  exit 1
fi
