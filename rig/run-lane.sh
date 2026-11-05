#!/bin/bash
# Native proof for one ChatUI perf lane on a GitHub-hosted macOS runner with Xcode.
# Usage: rig/run-lane.sh <lane> [samples]
# Builds base and head of the lane with the selected Xcode, runs the focused suites on
# unmodified code, then runs the shared ChatView workload ABAB on identically
# instrumented builds and records one os_signpost trace per side.
set -uo pipefail
LANE="$1"
SAMPLES="${2:-5}"
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

step "mermaid assets (base install, copied to head)"
(
  cd "$WORK/base" || exit 1
  pnpm install --frozen-lockfile --prefer-offline --optional \
    --filter '@openclaw/mermaid-renderer...' --filter '@openclaw/gateway-protocol...' \
    --config.ignore-scripts=false --config.engine-strict=false \
    --config.enable-pre-post-scripts=true >"$LOG/pnpm.log" 2>&1 &&
    node scripts/prepare-apple-mermaid.mjs >"$LOG/mermaid.log" 2>&1
) || { tail -40 "$LOG/pnpm.log" "$LOG/mermaid.log"; fail "mermaid assets"; exit 1; }
M=apps/shared/OpenClawKit/Sources/OpenClawChatUI/Resources/Mermaid
mkdir -p "$WORK/head/apps/shared/mermaid" "$WORK/head/$(dirname "$M")"
cp -R "$WORK/base/apps/shared/mermaid/assets" "$WORK/head/apps/shared/mermaid/"
cp -R "$WORK/base/$M" "$WORK/head/$M"
endstep

KIT=apps/shared/OpenClawKit
FLAGS=(--disable-index-store -Xswiftc -gline-tables-only)
REL=(-c release -Xswiftc -enable-testing --disable-index-store)

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
  git -C "$WORK/$side" add -N "$KIT" && git -C "$WORK/$side" diff -- "$KIT" >"$OUT/$side-instrumentation.diff"
  swift build --package-path "$WORK/$side/$KIT" --scratch-path "$WORK/scratch-$side-rel" "${REL[@]}" --build-tests \
    >"$LOG/$side-build-release.log" 2>&1 || { grep -E "error:" "$LOG/$side-build-release.log" | head -20; fail "$side release build"; }
  endstep
done

# Probe placement must be identical apart from line numbers.
diff <(sed 's/:[0-9]*//' "$OUT/base-probes.txt") <(sed 's/:[0-9]*//' "$OUT/head-probes.txt") || fail "probe sets differ"

run_workload() {
  local side="$1" sample="$2"
  CHAT_PERF_PROOF=1 CHAT_PERF_OUT="$OUT/samples" CHAT_PERF_LABEL="$side" CHAT_PERF_SAMPLE="$sample" \
    swift test --package-path "$WORK/$side/$KIT" --scratch-path "$WORK/scratch-$side-rel" "${REL[@]}" \
    --skip-build --filter ChatPerfProofWorkload >"$LOG/$side-workload-$sample.log" 2>&1 ||
    { tail -30 "$LOG/$side-workload-$sample.log"; fail "$side workload sample $sample"; }
  grep -E "CHAT_PERF_PROOF|Test run with" "$LOG/$side-workload-$sample.log"
}

step "workload ABAB x$SAMPLES"
mkdir -p "$OUT/samples"
uptime | tee "$OUT/load-before.txt"
for i in $(seq 1 "$SAMPLES"); do
  run_workload base "$i"
  run_workload head "$i"
done
uptime | tee "$OUT/load-after.txt"
endstep

step "os_signpost trace, one extra run per side"
for side in base head; do
  trace="$WORK/$side.trace"
  rm -rf "$trace"
  xcrun xctrace record --template 'Time Profiler' --instrument os_signpost --all-processes \
    --time-limit 600s --output "$trace" >"$LOG/$side-xctrace.log" 2>&1 &
  xpid=$!
  sleep 8
  run_workload "$side" trace
  sleep 2
  kill -INT "$xpid" 2>/dev/null
  wait "$xpid"
  tail -5 "$LOG/$side-xctrace.log"
  if [ -d "$trace" ]; then
    xcrun xctrace export --input "$trace" --toc >"$OUT/$side-trace-toc.xml" 2>"$LOG/$side-export.log"
    for schema in os-signpost-interval os-signpost; do
      xcrun xctrace export --input "$trace" \
        --xpath "/trace-toc/run[@number=\"1\"]/data/table[@schema=\"$schema\"]" \
        >"$WORK/$side-$schema.xml" 2>>"$LOG/$side-export.log" || true
    done
    python3 -I "$RIG/signposts.py" "$side" "$WORK/$side-os-signpost-interval.xml" "$WORK/$side-os-signpost.xml" \
      >"$OUT/$side-signposts.json" 2>>"$LOG/$side-export.log" || fail "$side signpost export"
  else
    fail "$side trace not recorded"
  fi
done
endstep

step "summary"
python3 -I "$RIG/summarize.py" "$LANE" "$OUT" "$(field title)" | tee "$OUT/summary.md"
[ -n "${GITHUB_STEP_SUMMARY:-}" ] && cat "$OUT/summary.md" >>"$GITHUB_STEP_SUMMARY"
endstep

if [ -s "$OUT/status.txt" ]; then
  cat "$OUT/status.txt"
  exit 1
fi
