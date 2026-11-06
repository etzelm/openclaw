#!/bin/bash
# Real-Xcode proof for reconnecting after consecutive missed keepalive pongs.
# Usage: rig/run.sh focused | full
#   focused: red tree (base + test seam + new tests, keepalive failures still ignored as on base):
#            the consecutive-miss test must fail and the single-miss test must pass.
#            Then the exact head tree: GatewayNetworkPathRecoveryTests must pass.
#   full:    full OpenClawKit swift test on the exact head tree.
set -uo pipefail
MODE="$1"
RIG="$(cd "$(dirname "$0")" && pwd)"
BASE="cb73e59f9356796d4eec6ffeffff327e213355a6"
RED_TREE="7cba07ddcfbd9c1616a0a675b07e41ef66089760"
HEAD_TREE="8beb1700ee42c07a14e17ceff164dff312da5b91"
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
echo "unknown mode $MODE"
exit 2
