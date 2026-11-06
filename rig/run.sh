#!/bin/bash
# Real-Xcode proof for reconnecting after consecutive missed keepalive pongs.
# Usage: rig/run.sh focused | full
#   focused: red tree (base + test seam + new tests, keepalive failures still ignored as on base):
#            the consecutive-miss test must fail and the single-miss test must pass.
#            Then the exact head tree: GatewayNetworkPathRecoveryTests must pass.
#   full:    full OpenClawKit swift test on the exact head tree.
#   native:  proof-only harness (rig/harness.diff): real URLSession socket to a fixture Gateway that goes
#            silent with no path change; base then head, KEEPALIVE_PROOF lines into the summary.
set -uo pipefail
MODE="$1"
RIG="$(cd "$(dirname "$0")" && pwd)"
BASE="cb73e59f9356796d4eec6ffeffff327e213355a6"
RED_TREE="9f6b7a9016187eae9e4e4969c0427032ef212301"
HEAD_TREE="14a1ed9c5b04c221a9878edfd35a304ead1935f0"
BASE_HARNESS_TREE="112f483ceee25116f1579793c09443bdea9f3a9e"
HEAD_HARNESS_TREE="5d06ec3ad73fd2627bb6e3d294573286ee85f42c"
SUITE="GatewayNetworkPathRecoveryTests"
RED_TEST="consecutive keepalive misses reconnect before the tick watchdog"
GUARD_TEST="a keepalive miss between healthy pongs keeps the socket"
WORK="${RUNNER_TEMP:-/tmp}/keepalive-miss"
OUT="$WORK/out/$MODE"
SRC="$WORK/src"
mkdir -p "$OUT"
summary() { cat >>"${GITHUB_STEP_SUMMARY:-/dev/null}"; }

rm -rf "$SRC"
git init -q "$SRC"
git -C "$SRC" fetch -q --depth 1 https://github.com/openclaw/openclaw.git "$BASE" || exit 1
git -C "$SRC" checkout -q --detach FETCH_HEAD
{ echo "base $BASE"; xcodebuild -version; swift --version 2>&1; sw_vers; sysctl -n hw.ncpu; } | tee "$OUT/environment.txt"
cd "$SRC" || exit 1
pnpm install --frozen-lockfile --prefer-offline --optional \
  --filter '@openclaw/mermaid-renderer...' --filter '@openclaw/gateway-protocol...' \
  --config.ignore-scripts=false --config.engine-strict=false \
  --config.enable-pre-post-scripts=true >"$OUT/pnpm.log" 2>&1 || { tail -40 "$OUT/pnpm.log"; exit 1; }
node scripts/prepare-apple-mermaid.mjs >"$OUT/mermaid.log" 2>&1 || { tail -40 "$OUT/mermaid.log"; exit 1; }

swift_test() {
  swift test --package-path apps/shared/OpenClawKit --scratch-path "$WORK/scratch" \
    --disable-index-store -Xswiftc -gline-tables-only "$@"
}

apply_tree() {
  git -C "$SRC" reset -q --hard
  git -C "$SRC" apply --index "$RIG/$1" || exit 1
  tree="$(git -C "$SRC" write-tree)"
  echo "$1 tree $tree (expected $2)" | tee -a "$OUT/environment.txt"
  test "$tree" = "$2" || exit 1
}

if [ "$MODE" = focused ]; then
  apply_tree red.diff "$RED_TREE"
  swift_test --filter "$SUITE" >"$OUT/red.log" 2>&1
  red=$?
  grep -E "Test run with|✘|✔.*keepalive|error:" "$OUT/red.log" | tail -30 | tee "$OUT/red-result.txt"
  echo "exit $red" | tee -a "$OUT/red-result.txt"
  apply_tree head.diff "$HEAD_TREE"
  swift_test --filter "$SUITE" >"$OUT/green.log" 2>&1
  green=$?
  grep -E "Test run with|✘|✔.*keepalive|error:" "$OUT/green.log" | tail -30 | tee "$OUT/green-result.txt"
  echo "exit $green" | tee -a "$OUT/green-result.txt"
  {
    echo "### red: base $BASE + seam and new tests, keepalive failures ignored (tree $RED_TREE)"
    echo '```'; cat "$OUT/red-result.txt"; echo '```'
    echo "### green: head tree $HEAD_TREE"
    echo '```'; cat "$OUT/green-result.txt"; echo '```'
  } | summary
  red_failed=0; guard_passed=0
  grep -Eq "✘ Test \"$RED_TEST\" failed" "$OUT/red.log" && red_failed=1
  grep -Eq "✔ Test \"$GUARD_TEST\" passed" "$OUT/red.log" && guard_passed=1
  test "$red" -ne 0 && test "$red_failed" = 1 && test "$guard_passed" = 1 && test "$green" -eq 0
  exit $?
fi

if [ "$MODE" = full ]; then
  apply_tree head.diff "$HEAD_TREE"
  swift_test --parallel >"$OUT/full.log" 2>&1
  code=$?
  grep -E "Test run with|Executed [0-9]+ test|error:|✘" "$OUT/full.log" | tail -40 | tee "$OUT/full-result.txt"
  echo "exit $code" | tee -a "$OUT/full-result.txt"
  { echo "### full OpenClawKit swift test on head tree $HEAD_TREE"; echo '```'; cat "$OUT/full-result.txt"; echo '```'; } | summary
  exit "$code"
fi
if [ "$MODE" = native ]; then
  for side in base head; do
    git -C "$SRC" reset -q --hard
    if [ "$side" = head ]; then git -C "$SRC" apply --index "$RIG/head.diff" || exit 1; want="$HEAD_HARNESS_TREE"; else want="$BASE_HARNESS_TREE"; fi
    git -C "$SRC" apply --index "$RIG/harness.diff" || exit 1
    tree="$(git -C "$SRC" write-tree)"
    echo "$side+harness tree $tree (expected $want)" | tee -a "$OUT/environment.txt"
    test "$tree" = "$want" || exit 1
    swift_test --filter KeepaliveMissNativeProofTests >"$OUT/native-$side.log" 2>&1
    echo "exit $?" >>"$OUT/native-$side.log"
    { echo "### $side + harness (tree $tree)"; echo '```'; grep -E "KEEPALIVE_PROOF|Test run with|^exit" "$OUT/native-$side.log"; echo '```'; } | summary
  done
  grep -q "reason=gateway socket unresponsive to keepalive pings" "$OUT/native-head.log"
  exit $?
fi

echo "unknown mode $MODE"
exit 2
