#!/bin/bash
# OpenClawKit `swift test` with Xcode, no shims.
#   focused <side>  the background-wake drain suite plus the outbox suites it builds on
#   full head       every OpenClawKit test on the exact head tree
# Usage: rig/swift.sh focused|full <side>
set -uo pipefail
MODE="$1"
SIDE="$2"
RIG="$(cd "$(dirname "$0")" && pwd)"
WORK="${RUNNER_TEMP:-/tmp}/bg-outbox-flush-proof/$MODE-$SIDE"
OUT="${RUNNER_TEMP:-/tmp}/bg-outbox-flush-proof/out/swift-$MODE-$SIDE"
mkdir -p "$WORK" "$OUT"
bash "$RIG/source.sh" "$SIDE" "$WORK/src" --native-assets | tee "$OUT/source.txt" || exit 1
{ xcodebuild -version; swift --version 2>&1; sw_vers; sysctl -n hw.ncpu; } | tee "$OUT/environment.txt"

FILTER='ChatViewModelOutboxBackgroundWakeTests|ChatViewModelOutboxTests|ChatViewModelOutboxSettingsTests|NativeConversationOutboxTests'
args=(--package-path "$WORK/src/apps/shared/OpenClawKit" --scratch-path "$WORK/scratch" --disable-index-store -Xswiftc -gline-tables-only)
if [ "$MODE" = focused ]; then
  args+=(--filter "$FILTER")
else
  args+=(--parallel)
fi
perl -e 'alarm shift; exec @ARGV' 3300 swift test "${args[@]}" >"$OUT/swift-test.log" 2>&1
code=$?
{
  grep -E "error:|Test run with|Executed [0-9]+ test|✘|ChatViewModelOutboxBackgroundWakeTests" "$OUT/swift-test.log" |
    grep -vE "^\s*$" | sed "s#$WORK/src/##g" | tail -60
  echo "exit $code"
} | tee "$OUT/result.txt"
{
  echo "### swift test $MODE on $SIDE ($(tail -1 "$OUT/source.txt"))"
  echo '```'
  tail -40 "$OUT/result.txt"
  echo '```'
} >>"${GITHUB_STEP_SUMMARY:-/dev/null}"
# base-tests must fail to build: the drain API it tests does not exist on the base.
if [ "$SIDE" = base-tests ]; then
  if [ "$code" -ne 0 ] && grep "error:" "$OUT/swift-test.log" | grep -q "drainOutboxForBackgroundWake"; then
    echo "RED_AS_EXPECTED" | tee -a "$OUT/result.txt"
    exit 0
  fi
  echo "::error::base-tests unexpectedly passed"
  exit 1
fi
exit "$code"
