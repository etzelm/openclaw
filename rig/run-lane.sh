#!/bin/bash
# Native proof for one ChatUI perf lane on a GitHub-hosted macOS runner with Xcode.
# Usage: rig/run-lane.sh <lane> <mode> [rounds]
#   prepare   fetch base, apply the lane diff, check the head tree, install native assets
#   focused   debug build + focused suites on unmodified base and head
#   build     instrument both sides identically and build the release workload
#   workload  run the shared ChatView workload interleaved base/head for <rounds> rounds
#   trace     one extra run per side under xctrace (os_signpost), bounded; may fail
#   summary   write summary.md, counts.json and the job summary table
set -uo pipefail
LANE="$1"
MODE="$2"
ROUNDS="${3:-7}"
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
fail() { echo "::error::$*"; echo "FAILED: $*" >> "$OUT/status.txt"; }
# Hard wall-clock limit for any single command: limit <seconds> <command...>
limit() { local secs="$1"; shift; perl -e 'alarm shift; exec @ARGV' "$secs" "$@"; }

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
  echo "TREE_OK" | tee -a "$OUT/tree-check.txt"
  git -C "$src" -c user.name=proof -c user.email=proof@invalid commit -q -m "head $HEAD"
  git -C "$src" worktree add -q --detach "$WORK/base" "$BASE"
  git -C "$src" worktree add -q --detach "$WORK/head" "$(git -C "$src" rev-parse HEAD)"
  endstep

  step "toolchain"
  {
    xcodebuild -version
    swift --version 2>&1
    sw_vers
    sysctl -n machdep.cpu.brand_string hw.ncpu hw.memsize
    echo "runner image: ${ImageOS:-unknown} ${ImageVersion:-unknown}"
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
  local code=0
  for side in base head; do
    step "$side: focused suites on unmodified code ($FOCUS)"
    if swift build --package-path "$WORK/$side/$KIT" --scratch-path "$WORK/scratch-$side-debug" "${FLAGS[@]}" --build-tests \
      >"$LOG/$side-build-debug.log" 2>&1; then
      limit 900 swift test --package-path "$WORK/$side/$KIT" --scratch-path "$WORK/scratch-$side-debug" "${FLAGS[@]}" \
        --skip-build --filter "$FOCUS" >"$LOG/$side-focused.log" 2>&1 || { fail "$side focused suites"; code=1; }
      grep -E "Test run with|✘" "$LOG/$side-focused.log" | tee "$OUT/$side-focused.txt"
    else
      grep -E "error:" "$LOG/$side-build-debug.log" | head -20
      fail "$side debug build"
      code=1
    fi
    rm -rf "$WORK/scratch-$side-debug"
    endstep
  done
  return "$code"
}

build() {
  for side in base head; do
    step "$side: instrument and build release workload"
    python3 -I "$RIG/instrument.py" "$WORK/$side/$KIT/Sources/OpenClawChatUI" "$RIG/ChatPerfProbe.swift" | tee "$OUT/$side-probes.txt"
    test "${PIPESTATUS[0]}" = 0 || { fail "$side instrument"; exit 1; }
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
    swift build --package-path "$WORK/$side/$KIT" --scratch-path "$WORK/scratch-$side-rel" "${REL[@]}" --build-tests \
      >"$LOG/$side-build-release.log" 2>&1 || { grep -E "error:" "$LOG/$side-build-release.log" | head -30; fail "$side release build"; exit 1; }
    endstep
  done
  # Probe placement must be identical apart from line numbers; so must the workload file.
  diff <(sed 's/:[0-9]*//' "$OUT/base-probes.txt") <(sed 's/:[0-9]*//' "$OUT/head-probes.txt") || { fail "probe sets differ"; exit 1; }
}

run_workload() {
  local side="$1" sample="$2"
  CHAT_PERF_PROOF=1 CHAT_PERF_OUT="$OUT/samples" CHAT_PERF_LABEL="$side" CHAT_PERF_SAMPLE="$sample" \
    limit 240 swift test --package-path "$WORK/$side/$KIT" --scratch-path "$WORK/scratch-$side-rel" "${REL[@]}" \
    --skip-build --filter ChatPerfProofWorkload >"$LOG/$side-workload-$sample.log" 2>&1
  local code=$?
  grep -E "CHAT_PERF_PROOF|Test run with|✘|Expectation failed" "$LOG/$side-workload-$sample.log" | head -20
  if [ "$code" != 0 ]; then
    tail -30 "$LOG/$side-workload-$sample.log"
    fail "$side workload sample $sample (exit $code)"
    return 1
  fi
}

workload() {
  step "workload interleaved base/head x$ROUNDS"
  mkdir -p "$OUT/samples"
  uptime | tee "$OUT/load-before.txt"
  local failures=0
  for i in $(seq 1 "$ROUNDS"); do
    run_workload base "$i" || failures=$((failures + 1))
    run_workload head "$i" || failures=$((failures + 1))
    # Stop early when the workload is clearly broken instead of burning the step budget.
    [ "$i" = 1 ] && [ "$failures" = 2 ] && { fail "first round failed on both sides"; break; }
  done
  uptime | tee "$OUT/load-after.txt"
  endstep
  [ "$failures" = 0 ]
}

trace() {
  step "os_signpost trace, one extra run per side (bounded)"
  local code=0
  for side in base head; do
    local trace="$WORK/$side.trace"
    rm -rf "$trace"
    # Only the os_signpost instrument (no Time Profiler) and a fixed time limit: xctrace stops by
    # itself, so nothing waits on a SIGINT-driven finalisation.
    limit 300 xcrun xctrace record --instrument os_signpost --all-processes \
      --time-limit 75s --output "$trace" >"$LOG/$side-xctrace.log" 2>&1 &
    local xpid=$!
    sleep 6
    run_workload "$side" trace || code=1
    wait "$xpid" || { echo "xctrace exit $?"; code=1; }
    tail -5 "$LOG/$side-xctrace.log"
    if [ -d "$trace" ]; then
      limit 240 xcrun xctrace export --input "$trace" \
        --xpath '/trace-toc/run[@number="1"]/data/table[@schema="os-signpost-interval"]' \
        >"$WORK/$side-os-signpost-interval.xml" 2>"$LOG/$side-export.log" || code=1
      python3 -I "$RIG/signposts.py" "$side" "$WORK/$side-os-signpost-interval.xml" \
        >"$OUT/$side-signposts.json" 2>>"$LOG/$side-export.log" || { echo "$side signpost export empty"; code=1; }
    else
      echo "$side trace not recorded"
      code=1
    fi
  done
  endstep
  return "$code"
}

summary() {
  step "summary"
  python3 -I "$RIG/summarize.py" "$LANE" "$OUT" "$(field title)" >"$OUT/summary.md" || fail "summarize"
  cat "$OUT/summary.md"
  [ -n "${GITHUB_STEP_SUMMARY:-}" ] && cat "$OUT/summary.md" >>"$GITHUB_STEP_SUMMARY"
  endstep
  if [ -s "$OUT/status.txt" ]; then
    cat "$OUT/status.txt"
    return 1
  fi
}

case "$MODE" in
  prepare) prepare ;;
  focused) focused ;;
  build) build ;;
  workload) workload ;;
  trace) trace ;;
  summary) summary ;;
  *) echo "unknown mode $MODE"; exit 2 ;;
esac
