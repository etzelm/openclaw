#!/bin/bash
# Native proof for one ChatUI perf lane on a GitHub-hosted macOS runner with Xcode.
# Usage: rig/run-lane.sh <lane> prepare|workload [samples]
# Builds base and head of the lane with the selected Xcode, runs the focused suites on
# unmodified code, then runs the shared ChatView workload ABAB on identically
# instrumented builds and records one os_signpost trace per side.
set -uo pipefail
LANE="$1"
STAGE="$2"
SAMPLES="${3:-5}"
RIG="$(cd "$(dirname "$0")" && pwd)"
WORK="${RUNNER_TEMP:-/tmp}/chatui-proof"
OUT="${PROOF_OUT:-$WORK/out}/$LANE"
mkdir -p "$WORK" "$OUT"
LOG="$OUT/logs"
mkdir -p "$LOG"

field() { python3 -I -c 'import json,sys; print(json.load(open(sys.argv[1]))[sys.argv[2]][sys.argv[3]])' "$RIG/lanes.json" "$LANE" "$1"; }
BASE="$(field base)"
HEAD="$(field head)"
HEAD_TREE="$(field headTree)"
FOCUS="$(field focus)"
step() { echo "::group::$*"; echo "=== $(date -u +%H:%M:%S) $*"; }
endstep() { echo "::endgroup::"; }
fail() { echo "::error::$*"; echo "FAILED: $*" >> "$OUT/status.txt"; }

KIT=apps/shared/OpenClawKit
FLAGS=(--disable-index-store -Xswiftc -gline-tables-only)
REL=(-c release -Xswiftc -enable-testing --disable-index-store)

if [ "$STAGE" = prepare ]; then
step "source: base $BASE, head $HEAD"
SRC="$WORK/src"
rm -rf "$SRC"
git init -q "$SRC"
git -C "$SRC" fetch -q --depth 1 https://github.com/openclaw/openclaw.git "$BASE" || { fail "fetch base"; exit 1; }
git -C "$SRC" checkout -q --detach FETCH_HEAD
test "$(git -C "$SRC" rev-parse HEAD)" = "$BASE" || { fail "base sha mismatch"; exit 1; }
git -C "$SRC" apply --index "$RIG/lanes/$LANE.diff" || { fail "head diff does not apply"; exit 1; }
tree="$(git -C "$SRC" write-tree)"
echo "head tree $tree (expected $HEAD_TREE)"
test "$tree" = "$HEAD_TREE" || { fail "head tree mismatch"; exit 1; }
git -C "$SRC" -c user.name=proof -c user.email=proof@invalid commit -q -m "head $HEAD"
HEAD_LOCAL="$(git -C "$SRC" rev-parse HEAD)"
git -C "$SRC" worktree add -q --detach "$WORK/base" "$BASE"
git -C "$SRC" worktree add -q --detach "$WORK/head" "$HEAD_LOCAL"
endstep

step "toolchain"
{
  xcodebuild -version
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

for side in base head; do
  step "$side: focused suites on unmodified code ($FOCUS)"
  if swift build --package-path "$WORK/$side/$KIT" --scratch-path "$WORK/scratch-$side-debug" "${FLAGS[@]}" --build-tests \
    >"$LOG/$side-build-debug.log" 2>&1; then
    swift test --package-path "$WORK/$side/$KIT" --scratch-path "$WORK/scratch-$side-debug" "${FLAGS[@]}" \
      --skip-build --filter "$FOCUS" >"$LOG/$side-focused.log" 2>&1 || fail "$side focused suites"
    grep -E "Test run with|Executed [0-9]+ test" "$LOG/$side-focused.log" | tee "$OUT/$side-focused.txt"
  else
    grep -E "error:" "$LOG/$side-build-debug.log" | head -20
    fail "$side debug build"
  fi
  rm -rf "$WORK/scratch-$side-debug"
  endstep

  step "$side: instrument and build release workload"
  python3 -I "$RIG/instrument.py" "$WORK/$side/$KIT/Sources/OpenClawChatUI" "$RIG/ChatPerfProbe.swift" | tee "$OUT/$side-probes.txt"
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
    >"$LOG/$side-build-release.log" 2>&1 || { grep -E "error:" "$LOG/$side-build-release.log" | head -20; fail "$side release build"; }
  endstep
done

# Probe placement must be identical apart from line numbers.
sed -E 's/:[0-9]+( |$)/\1/' "$OUT/base-probes.txt" >"$OUT/probe-set.txt"
diff "$OUT/probe-set.txt" <(sed -E 's/:[0-9]+( |$)/\1/' "$OUT/head-probes.txt") || fail "probe sets differ"
if [ -s "$OUT/status.txt" ]; then cat "$OUT/status.txt"; exit 1; fi
exit 0
fi

# shellcheck source=/dev/null
source "$RIG/workload.sh"

step "workload, interleaved base/head x$SAMPLES (odd rounds base first, even rounds head first)"
mkdir -p "$OUT/samples"
uptime | tee "$OUT/load-before.txt"
for i in $(seq 1 "$SAMPLES"); do
  if [ $((i % 2)) -eq 1 ]; then order="base head"; else order="head base"; fi
  for side in $order; do run_workload "$side" "$i"; done
done
uptime | tee "$OUT/load-after.txt"
endstep

step "summary (counts only; the trace step appends its own section)"
python3 -I "$RIG/summarize.py" "$LANE" "$OUT" "$(field title)" | tee "$OUT/summary.md"
endstep

if [ -s "$OUT/status.txt" ]; then
  cat "$OUT/status.txt"
  exit 1
fi
