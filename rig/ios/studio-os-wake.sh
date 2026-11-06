#!/bin/bash
# Studio driver: real OS wake proof for one side. The app runs in the iOS simulator as the unit-test
# host; BgOutboxOSWakeProofTests configures the running app's own model and queues a message, then
# this script drives the OS: a real app switch to the background, the app's real grace period, a real
# silent push through `xcrun simctl push`, and a real return to the foreground. The app's own
# PushWake/BackgroundWake log lines are streamed from the simulator.
# Usage: rig/ios/studio-os-wake.sh base|head <out-dir> <scenario...>   (scenario: push | bgtask | bgtask-bound)
set -uo pipefail
SIDE="$1"
OUT="$2"
shift 2
SCENARIOS=("$@")
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
RIG="$ROOT/rig"
WORK="$ROOT/.studio/os-$SIDE"
SRC="$WORK/src"
TOOLS="$ROOT/.studio/tools-os-$SIDE"
mkdir -p "$WORK" "$OUT" "$TOOLS"
die() { echo "FAILED: $*" | tee -a "$OUT/status.txt"; exit 1; }
stamp() { echo "=== $(date -u +%H:%M:%S) $*"; }
now() { python3 -I -c 'import time; print("%.3f" % time.time())'; }

stamp "source $SIDE"
bash "$RIG/source.sh" "$SIDE" "$SRC" --native-assets | tee "$OUT/source.txt" || die source
cp "$RIG/ios/BgOutboxFlushProofTests.swift" "$RIG/ios/BgOutboxDeliveryProofTests.swift" "$SRC/apps/ios/Tests/"
if git -C "$SRC" apply --check "$RIG/harness.diff" 2>/dev/null; then
  git -C "$SRC" apply "$RIG/harness.diff" || die harness
else
  git -C "$SRC" apply -R --check "$RIG/harness.diff" || die "harness neither applies nor is present"
fi

stamp "tools"
(cd "$SRC" && ./scripts/install-xcodegen.sh "$TOOLS") >"$OUT/tools.log" 2>&1 || die xcodegen
(cd "$SRC" && ./scripts/install-swift-tools.sh "$TOOLS") >>"$OUT/tools.log" 2>&1 || die swift-tools
export PATH="$TOOLS:$PATH"

stamp "generate (no Watch dependency, local only)"
(cd "$SRC" && pnpm ios:gen) >"$OUT/iosgen.log" 2>&1 || die ios:gen
(
  cd "$SRC/apps/ios" &&
    awk '!done && $0 == "      - target: OpenClawWatchApp" { done = 1; next } { print }' project.yml >.nowatch.yml &&
    xcodegen generate --spec .nowatch.yml >>"$OUT/iosgen.log" 2>&1
) || die "nowatch generate"

stamp "simulator"
SIM_ID="$(xcrun simctl create "bg-outbox-os-$SIDE" "iPhone 18 Pro" com.apple.CoreSimulator.SimRuntime.iOS-27-2)" || die create
trap 'xcrun simctl shutdown "$SIM_ID" >/dev/null 2>&1; xcrun simctl delete "$SIM_ID" >/dev/null 2>&1' EXIT
xcrun simctl boot "$SIM_ID" >/dev/null 2>&1
perl -e 'alarm shift; exec @ARGV' 300 xcrun simctl bootstatus "$SIM_ID" -b >/dev/null 2>&1 || die boot
{ xcodebuild -version; sw_vers -productVersion; echo "$SIM_ID iPhone 18 Pro iOS 27.2"; } >"$OUT/toolchain.txt"

XC=(-project "$SRC/apps/ios/OpenClaw.xcodeproj" -scheme OpenClaw -configuration Debug
  -destination "platform=iOS Simulator,id=$SIM_ID" -derivedDataPath "$WORK/dd"
  -clonedSourcePackagesDirPath "$WORK/spm" ARCHS="$(uname -m)" ONLY_ACTIVE_ARCH=YES COMPILER_INDEX_STORE_ENABLE=NO)
stamp "build-for-testing"
perl -e 'alarm shift; exec @ARGV' 3600 xcodebuild "${XC[@]}" build-for-testing >"$OUT/build.log" 2>&1 || {
  grep -E " error:" "$OUT/build.log" | head -10
  die build
}
BUNDLE="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' \
  "$WORK/dd/Build/Products/Debug-iphonesimulator/OpenClaw.app/Info.plist")" || die bundle
echo "bundle $BUNDLE" >>"$OUT/toolchain.txt"
# The simulator refuses pushes without visible content (UNErrorDomain 1401), so the payload adds an alert.
# The app treats any push with content-available 1 as a background wake, as it does on a device.
printf '{"aps":{"alert":{"title":"OpenClaw proof","body":"background wake"},"content-available":1}}\n' >"$WORK/silent.apns"

waitfor() { # waitfor <seconds> <file> <fixed-string>
  local deadline=$(($(date +%s) + $1))
  until grep -qF "$3" "$2" 2>/dev/null; do
    [ "$(date +%s)" -lt "$deadline" ] || return 1
    sleep 0.5
  done
}

rc=0
for scenario in "${SCENARIOS[@]}"; do
  stamp "scenario $scenario"
  LOG="$OUT/os-log-$scenario-$SIDE.txt"
  EV="$OUT/os-events-$scenario-$SIDE.txt"
  : >"$EV"
  xcrun simctl spawn "$SIM_ID" log stream --style compact --level info \
    --predicate 'subsystem == "ai.openclawfoundation.app" AND (category == "PushWake" OR category == "BackgroundWake")' \
    >"$LOG" 2>&1 &
  LOGPID=$!
  TEST_RUNNER_BG_OUTBOX_OS_SCENARIO="$scenario" TEST_RUNNER_BG_OUTBOX_PROOF_SIDE="$SIDE" \
    TEST_RUNNER_BG_OUTBOX_PROOF_OUT="$OUT" \
    perl -e 'alarm shift; exec @ARGV' 600 xcodebuild "${XC[@]}" test-without-building \
    -only-testing:OpenClawTests/BgOutboxOSWakeProofTests -parallel-testing-enabled NO \
    -collect-test-diagnostics never >"$OUT/xcodebuild-$scenario.log" 2>&1 &
  XPID=$!
  step_ok=1
  if waitfor 300 "$OUT/os-$scenario-$SIDE-ready.txt" "ready"; then
    echo "$(now) host app_switch_to_background" >>"$EV"
    xcrun simctl launch "$SIM_ID" com.apple.Preferences >/dev/null
    if waitfor 90 "$LOG" "Background reconnect suppressed reason=background_grace"; then
      echo "$(now) host grace_ended_seen" >>"$EV"
      if [ "${scenario#bgtask}" != "$scenario" ]; then
        # The test launches the refresh task in-process once it sees the disconnect.
        waitfor 60 "$LOG" "Background refresh wake outcome" && echo "$(now) host refresh_outcome_seen" >>"$EV" || {
          echo "$(now) host refresh_outcome_missing" >>"$EV"
          step_ok=0
        }
      else
        sleep 3
        echo "$(now) host simctl_push" >>"$EV"
        xcrun simctl push "$SIM_ID" "$BUNDLE" "$WORK/silent.apns" >>"$EV" 2>&1
        waitfor 60 "$LOG" "Silent push outcome" && echo "$(now) host push_outcome_seen" >>"$EV" || {
          echo "$(now) host push_outcome_missing" >>"$EV"
          step_ok=0
        }
      fi
      sleep 5
    else
      echo "$(now) host grace_end_missing" >>"$EV"
      step_ok=0
    fi
    echo "$(now) host foreground_app" >>"$EV"
    xcrun simctl launch "$SIM_ID" "$BUNDLE" >/dev/null 2>&1
  else
    echo "$(now) host ready_missing" >>"$EV"
    step_ok=0
  fi
  wait "$XPID"
  xrc=$?
  sleep 1
  kill "$LOGPID" 2>/dev/null
  wait "$LOGPID" 2>/dev/null
  echo "scenario $scenario xcodebuild exit $xrc step_ok $step_ok" | tee -a "$OUT/result.txt"
  [ "$xrc" = 0 ] && [ "$step_ok" = 1 ] || rc=1
done
exit "$rc"
