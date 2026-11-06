#!/bin/bash
# Studio driver: simulator proof for one side.
# Same source prep and proof test as rig/ios/run.sh, but the studio has no Rust toolchain, so the
# iOS app's OpenClawWatchApp dependency is dropped from a local copy of project.yml before generating.
# Usage: rig/ios/studio-run-sim.sh base|head <out-dir>
set -uo pipefail
SIDE="$1"
OUT="$2"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
RIG="$ROOT/rig"
WORK="$ROOT/.studio/$SIDE"
SRC="$WORK/src"
TOOLS="$ROOT/.studio/tools"
mkdir -p "$WORK" "$OUT" "$TOOLS"
die() { echo "FAILED: $*" | tee -a "$OUT/status.txt"; exit 1; }
stamp() { echo "=== $(date -u +%H:%M:%S) $*"; }

stamp "source $SIDE"
bash "$RIG/source.sh" "$SIDE" "$SRC" --native-assets | tee "$OUT/source.txt" || die source
cp "$RIG/ios/BgOutboxFlushProofTests.swift" "$SRC/apps/ios/Tests/BgOutboxFlushProofTests.swift"
cp "$RIG/ios/BgOutboxDeliveryProofTests.swift" "$SRC/apps/ios/Tests/BgOutboxDeliveryProofTests.swift"
# Proof-only local Gateway methods for the delivery test (test fixture only, same on both sides).
git -C "$SRC" apply "$RIG/harness.diff" || die harness

stamp "tools"
if [ ! -x "$TOOLS/xcodegen" ]; then
  (cd "$SRC" && ./scripts/install-xcodegen.sh "$TOOLS") >"$OUT/tools.log" 2>&1 || die xcodegen
fi
if [ ! -x "$TOOLS/swiftformat" ]; then
  (cd "$SRC" && ./scripts/install-swift-tools.sh "$TOOLS") >>"$OUT/tools.log" 2>&1 || die swift-tools
fi
export PATH="$TOOLS:$PATH"

stamp "generate (no Watch dependency, local only)"
(cd "$SRC" && pnpm ios:gen) >"$OUT/iosgen.log" 2>&1 || { tail -20 "$OUT/iosgen.log"; die ios:gen; }
(
  cd "$SRC/apps/ios" &&
    awk '!done && $0 == "      - target: OpenClawWatchApp" { done = 1; next } { print }' project.yml >.nowatch.yml &&
    diff project.yml .nowatch.yml >"$OUT/nowatch-spec.diff"
  xcodegen generate --spec .nowatch.yml >>"$OUT/iosgen.log" 2>&1
) || die "nowatch generate"
test -s "$OUT/nowatch-spec.diff" || die "nowatch diff empty"

stamp "simulator"
RUNTIME="com.apple.CoreSimulator.SimRuntime.iOS-27-2"
SIM_ID="$(xcrun simctl create "bg-outbox-proof-$SIDE" "iPhone 18 Pro" "$RUNTIME")" || die "simctl create"
trap 'xcrun simctl shutdown "$SIM_ID" >/dev/null 2>&1; xcrun simctl delete "$SIM_ID" >/dev/null 2>&1' EXIT
echo "$SIM_ID iPhone 18 Pro $RUNTIME" | tee "$OUT/simulator.txt"
xcrun simctl boot "$SIM_ID" >"$OUT/boot.log" 2>&1 || true
perl -e 'alarm shift; exec @ARGV' 300 xcrun simctl bootstatus "$SIM_ID" -b >>"$OUT/boot.log" 2>&1 || {
  tail -20 "$OUT/boot.log"
  die "simulator boot (headless)"
}
{ xcodebuild -version; swift --version 2>&1 | head -1; sw_vers; } | tee "$OUT/toolchain.txt"

tests=(-only-testing:OpenClawTests/BgOutboxFlushProofTests -only-testing:OpenClawTests/BgOutboxDeliveryProofTests)
if [ -z "${ONLY_PROOF:-}" ] && { [ "$SIDE" = head ] || [ "${ALL_SUITES:-}" = 1 ]; }; then
  tests+=(
    -only-testing:OpenClawTests/NodeAppModelInvokeTests
    -only-testing:OpenClawTests/BackgroundAliveBeaconTests
    -only-testing:OpenClawTests/ChatSendHydrationTests
    -only-testing:OpenClawTests/RootTabsPresentationTests
  )
fi

stamp "xcodebuild test $SIDE"
started=$(date +%s)
TEST_RUNNER_BG_OUTBOX_PROOF_OUT="$OUT" TEST_RUNNER_BG_OUTBOX_PROOF_SIDE="$SIDE" \
  perl -e 'alarm shift; exec @ARGV' 4200 xcodebuild \
  -project "$SRC/apps/ios/OpenClaw.xcodeproj" -scheme OpenClaw -configuration Debug \
  -destination "platform=iOS Simulator,id=$SIM_ID" \
  -derivedDataPath "$WORK/dd" -clonedSourcePackagesDirPath "$WORK/spm" \
  -resultBundlePath "$OUT/tests.xcresult" \
  -parallel-testing-enabled NO -collect-test-diagnostics never \
  ARCHS="$(uname -m)" ONLY_ACTIVE_ARCH=YES COMPILER_INDEX_STORE_ENABLE=NO ${STUDIO_SIGNING_ARGS:-} \
  "${tests[@]}" test >"$OUT/xcodebuild.log" 2>&1
rc=$?
echo "xcodebuild exit $rc after $(($(date +%s) - started)) s" | tee -a "$OUT/toolchain.txt"

{
  grep -E "BG_OUTBOX_PROOF |BG_OUTBOX_DELIVERY|Test run with|Executed [0-9]+ test|✘|error:|\*\* TEST" "$OUT/xcodebuild.log" |
    sed "s#$SRC/##g" | tail -60
  echo "exit $rc"
} | tee "$OUT/result.txt"

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
echo "VERDICT $SIDE: $verdict" | tee -a "$OUT/result.txt"
delivery="$(cat "$OUT/delivery-$SIDE.txt" 2>/dev/null)"
case "$SIDE:$delivery" in
  head:*sentBeforeReturn=true*sendCount=1*) dverdict="HEAD_DELIVERED" ;;
  base:*sentBeforeReturn=false*) dverdict="BASE_NOT_DELIVERED_BEFORE_RETURN" ;;
  *) dverdict="DELIVERY_UNEXPECTED" ;;
esac
echo "DELIVERY $SIDE: $dverdict | $delivery" | tee -a "$OUT/result.txt"
[ "$dverdict" = DELIVERY_UNEXPECTED ] && rc=1
case "$verdict" in HEAD_OK* | BASE_GAP_CONFIRMED*) ;; *) rc=1 ;; esac
exit "$rc"
