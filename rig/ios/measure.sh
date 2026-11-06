#!/bin/bash
# Run the scratch UI tests on one simulator, base and head interleaved.
# Usage: rig/ios/measure.sh setup
#        rig/ios/measure.sh run <first round> <last round>
# Expects products-base.tgz and products-head.tgz in $WORK/artifacts (downloaded artifacts).
set -uo pipefail
RIG="$(cd "$(dirname "$0")/.." && pwd)"
WORK="${RUNNER_TEMP:-/tmp}/ios-proof"
OUT="$WORK/out"
LOG="$OUT/logs"
mkdir -p "$LOG" "$OUT/samples"
fail() { echo "::error::$*"; echo "FAILED: $*" >>"$OUT/status-measure.txt"; }
TESTS=(
  -only-testing:OpenClawUITests/OpenClawSnapshotUITests/testScratchCitationProofCards
  -only-testing:OpenClawUITests/OpenClawSnapshotUITests/testScratchCitationProofNoCards
)

if [ "$1" = setup ]; then
  for side in base head; do
    mkdir -p "$WORK/products/$side"
    tar -xzf "$(find "$WORK/artifacts" -name "products-$side.tgz" | head -1)" -C "$WORK/products/$side" || { fail "untar $side"; exit 1; }
    ls "$WORK/products/$side"
  done
  udid="$(xcrun simctl list devices available --json | python3 -I -c '
import json, sys
devices = json.load(sys.stdin)["devices"]
best = None
for runtime, items in devices.items():
    if "iOS" not in runtime:
        continue
    for d in items:
        if d.get("isAvailable") and d["name"].startswith("iPhone") and "Pro" in d["name"] and "Max" not in d["name"]:
            key = (runtime, d["name"])
            if best is None or key > best[0]:
                best = (key, d["udid"])
if best is None:
    for runtime, items in devices.items():
        for d in items:
            if "iOS" in runtime and d.get("isAvailable") and d["name"].startswith("iPhone"):
                best = ((runtime, d["name"]), d["udid"])
print(best[1] if best else "")
')"
  test -n "$udid" || { fail "no iPhone simulator"; exit 1; }
  echo "$udid" >"$WORK/udid"
  perl -e 'alarm shift; exec @ARGV' 300 xcrun simctl boot "$udid" 2>&1 | tail -2
  perl -e 'alarm shift; exec @ARGV' 400 xcrun simctl bootstatus "$udid" -b | tail -2 || { fail "boot"; exit 1; }
  xcrun simctl status_bar "$udid" override --time 9:41 --dataNetwork wifi --wifiMode active --wifiBars 3 \
    --cellularMode active --cellularBars 4 --batteryState charged --batteryLevel 100 || true
  app="$(find "$WORK/products/base" -maxdepth 2 -name OpenClaw.app -type d | head -1)"
  bundle="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$app/Info.plist")"
  echo "$bundle" >"$WORK/bundle"
  {
    xcodebuild -version
    sw_vers
    sysctl -n machdep.cpu.brand_string hw.ncpu hw.memsize
    xcrun simctl list devices available --json | python3 -I -c '
import json, sys
udid = sys.argv[1]
for runtime, items in json.load(sys.stdin)["devices"].items():
    for d in items:
        if d["udid"] == udid:
            print("simulator:", d["name"], runtime.rsplit(".", 1)[-1])' "$udid"
    echo "app bundle: $bundle (Debug, iOS Simulator)"
    cat "$WORK"/artifacts/*/out/source-*.txt 2>/dev/null
  } | tee "$OUT/environment.txt"
  exit 0
fi

FIRST="$2"
LAST="$3"
UDID="$(cat "$WORK/udid")"
BUNDLE="$(cat "$WORK/bundle")"
container() { xcrun simctl get_app_container "$UDID" "$BUNDLE" data 2>/dev/null; }

run_side() {
  local side="$1" round="$2"
  local dir="$OUT/samples/$side-$round"
  local result="$WORK/results/$side-$round.xcresult"
  mkdir -p "$dir" "$WORK/results"
  rm -rf "$result"
  local data
  data="$(container)" && rm -f "$data"/tmp/chatperf-*.txt
  local xctestrun
  xctestrun="$(find "$WORK/products/$side" -maxdepth 1 -name '*.xctestrun' | head -1)"
  echo "=== $(date -u +%H:%M:%S) round $round $side"
  perl -e 'alarm shift; exec @ARGV' 660 xcodebuild test-without-building -xctestrun "$xctestrun" \
    -destination "id=$UDID" "${TESTS[@]}" -resultBundlePath "$result" >"$LOG/test-$side-$round.log" 2>&1
  local rc=$?
  grep -E "CHATPERF_|measured \[|Test Case .*(passed|failed)|error:|\*\* TEST" "$LOG/test-$side-$round.log" \
    | tee "$dir/marks.txt" | grep -vE "CHATPERF_MARK|CHATPERF_SCROLL" | cut -c1-220
  [ $rc -eq 0 ] || fail "$side round $round tests exit $rc"
  data="$(container)" && cp "$data"/tmp/chatperf-*.txt "$dir/" 2>/dev/null
  ls "$dir" | grep -c chatperf- | sed "s/^/event files: /"
  if [ -d "$result" ]; then
    perl -e 'alarm shift; exec @ARGV' 120 xcrun xcresulttool export attachments --path "$result" \
      --output-path "$dir/attachments" >/dev/null 2>&1 || echo "attachment export failed"
  fi
}

for round in $(seq "$FIRST" "$LAST"); do
  if [ $((round % 2)) -eq 1 ]; then order="base head"; else order="head base"; fi
  for side in $order; do run_side "$side" "$round"; done
done
uptime | tee -a "$OUT/load.txt"
exit 0
