#!/bin/bash
# Build the shipped iOS app's unit-test bundle (scheme OpenClaw, Debug, iOS Simulator) for one side
# and run the background-wake proof test. Head also runs the existing iOS suites around the changed wake code.
# Usage: rig/ios/run.sh base|head
set -uo pipefail
SIDE="$1"
RIG="$(cd "$(dirname "$0")/.." && pwd)"
WORK="${RUNNER_TEMP:-/tmp}/bg-outbox-flush-proof/ios-$SIDE"
OUT="${RUNNER_TEMP:-/tmp}/bg-outbox-flush-proof/out/ios-$SIDE"
SRC="$WORK/src"
mkdir -p "$WORK" "$OUT"
step() { echo "::group::$*"; echo "=== $(date -u +%H:%M:%S) $*"; }
endstep() { echo "::endgroup::"; }
die() { echo "::error::$*"; echo "FAILED: $*" >>"$OUT/status.txt"; exit 1; }

step "source ($SIDE)"
bash "$RIG/source.sh" "$SIDE" "$SRC" --native-assets | tee "$OUT/source.txt" || die "source"
cp "$RIG/ios/BgOutboxFlushProofTests.swift" "$SRC/apps/ios/Tests/BgOutboxFlushProofTests.swift"
cp "$RIG/ios/BgOutboxFlushProofTests.swift" "$OUT/"
endstep

step "tools"
TOOLS="$WORK/tools"
(cd "$SRC" && ./scripts/install-xcodegen.sh "$TOOLS") >"$OUT/tools.log" 2>&1 || { tail -20 "$OUT/tools.log"; die "xcodegen"; }
export PATH="$TOOLS:$HOME/.cargo/bin:$PATH"
watch_toolchain="$(awk -F '"' '/^channel =/ { print $2; exit }' "$SRC/apps/shared/OpenClawWatchRTC/rust-toolchain.toml")"
rustup toolchain install "$watch_toolchain" --profile minimal --component rust-src >>"$OUT/tools.log" 2>&1 ||
  { tail -20 "$OUT/tools.log"; die "rust toolchain"; }
(cd "$SRC" && pnpm ios:gen) >"$OUT/iosgen.log" 2>&1 || { tail -30 "$OUT/iosgen.log"; die "ios:gen"; }
endstep

step "simulator"
SIM="$(xcrun simctl list devices available --json | python3 -I -c '
import json, sys
for runtime, devices in json.load(sys.stdin)["devices"].items():
    for d in devices:
        if d.get("isAvailable") and d["name"].startswith("iPhone"):
            print(d["udid"], d["name"], runtime, sep="\t"); sys.exit(0)
sys.exit(1)')" || die "no iPhone simulator"
SIM_ID="${SIM%%$'\t'*}"
echo "$SIM" | tee "$OUT/simulator.txt"
xcrun simctl boot "$SIM_ID" 2>/dev/null || true
xcrun simctl bootstatus "$SIM_ID" -b >/dev/null 2>&1 || die "simulator boot"
{ xcodebuild -version; swift --version 2>&1 | head -1; sw_vers; } | tee "$OUT/toolchain.txt"
endstep

tests=(-only-testing:OpenClawTests/BgOutboxFlushProofTests)
if [ "$SIDE" = head ]; then
  tests+=(
    -only-testing:OpenClawTests/NodeAppModelInvokeTests
    -only-testing:OpenClawTests/BackgroundAliveBeaconTests
    -only-testing:OpenClawTests/ChatSendHydrationTests
    -only-testing:OpenClawTests/RootTabsPresentationTests
  )
fi

step "xcodebuild test ($SIDE)"
started=$(date +%s)
TEST_RUNNER_BG_OUTBOX_PROOF_OUT="$OUT" TEST_RUNNER_BG_OUTBOX_PROOF_SIDE="$SIDE" \
  perl -e 'alarm shift; exec @ARGV' 4200 xcodebuild \
  -project "$SRC/apps/ios/OpenClaw.xcodeproj" -scheme OpenClaw -configuration Debug \
  -destination "platform=iOS Simulator,id=$SIM_ID" \
  -derivedDataPath "$WORK/dd" -clonedSourcePackagesDirPath "$WORK/spm" \
  -resultBundlePath "$OUT/tests.xcresult" \
  -parallel-testing-enabled NO -collect-test-diagnostics never \
  ARCHS="$(uname -m)" ONLY_ACTIVE_ARCH=YES COMPILER_INDEX_STORE_ENABLE=NO \
  "${tests[@]}" test >"$OUT/xcodebuild.log" 2>&1
rc=$?
echo "xcodebuild exit $rc after $(($(date +%s) - started)) s" | tee -a "$OUT/toolchain.txt"
endstep

{
  grep -E "BG_OUTBOX_PROOF |Test run with|✘|error:|\*\* TEST" "$OUT/xcodebuild.log" | sed "s#$SRC/##g" | tail -60
  echo "exit $rc"
} | tee "$OUT/result.txt"
{
  echo "### iOS simulator, $SIDE ($(tail -1 "$OUT/source.txt"))"
  echo '```'
  cat "$OUT/simulator.txt" "$OUT/result.txt"
  echo '```'
} >>"${GITHUB_STEP_SUMMARY:-/dev/null}"
# Side verdict from the proof markers. Head: a queued row holds the wake open for the bounded drain
# (no Gateway here, so it ends at the deadline) and an empty outbox adds no delay. Base: the wake
# returns at once with the row still queued, which is the reported gap.
seconds() { sed -n 's/.*wakeSeconds=\([0-9.]*\).*/\1/p' "$OUT/wake-$1-$SIDE.txt" 2>/dev/null | head -1; }
queued="$(seconds queued)"
empty="$(seconds empty)"
verdict="missing markers"
if [ -n "$queued" ] && [ -n "$empty" ]; then
  if [ "$SIDE" = head ]; then
    awk -v q="$queued" -v e="$empty" 'BEGIN { exit !(q >= 7.5 && q < 15 && e < 2) }' &&
      verdict="HEAD_OK queued=${queued}s empty=${empty}s" || verdict="HEAD_UNEXPECTED queued=${queued}s empty=${empty}s"
  else
    awk -v q="$queued" -v e="$empty" 'BEGIN { exit !(q < 2 && e < 2) }' &&
      verdict="BASE_GAP_CONFIRMED queued=${queued}s empty=${empty}s" || verdict="BASE_UNEXPECTED queued=${queued}s empty=${empty}s"
  fi
fi
echo "$verdict" | tee -a "$OUT/result.txt"
echo "verdict: $verdict" >>"${GITHUB_STEP_SUMMARY:-/dev/null}"
case "$verdict" in HEAD_OK*|BASE_GAP_CONFIRMED*) ;; *) rc=1 ;; esac
xcrun simctl shutdown "$SIM_ID" 2>/dev/null || true
exit "$rc"
