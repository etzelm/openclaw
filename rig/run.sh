#!/bin/bash
# Real-Xcode proof for the chat reconnect catalog burst fix.
# Usage: rig/run.sh focused | full
#   focused: base + new test only (expect the new test to fail), then base + full head diff
#            (expect the new test and the related chat view model suites to pass). Same scratch dir, same runner.
#   full:    full OpenClawKit swift test on the exact head tree.
set -uo pipefail
MODE="$1"
RIG="$(cd "$(dirname "$0")" && pwd)"
BASE="cb73e59f9356796d4eec6ffeffff327e213355a6"
HEAD_TREE="9abb6dd7fca66db4354c376e7f3063f3538de22e"
TEST_NAME="flapping reconnects recover history before one catalog refresh"
RELATED='ChatViewModel|ChatModelSignIn|ChatStreamReplay|ChatQuestionCard|ChatSwarm|ChatSource|ChatComposer|ChatSessionCompletion|ChatProgress'
WORK="${RUNNER_TEMP:-/tmp}/reconnect-burst"
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

head_tree_check() {
  git -C "$SRC" apply --index "$RIG/head.diff" || exit 1
  tree="$(git -C "$SRC" write-tree)"
  echo "head tree $tree (expected $HEAD_TREE)" | tee -a "$OUT/environment.txt"
  test "$tree" = "$HEAD_TREE" || exit 1
}

if [ "$MODE" = focused ]; then
  # Red: base production code with the new test.
  git -C "$SRC" apply --index "$RIG/test-only.diff" || exit 1
  swift_test --filter ChatViewModelReconnectBurstTests >"$OUT/red.log" 2>&1
  red=$?
  grep -E "RECONNECT_BURST|Test run with|✘|Expectation failed|error:" "$OUT/red.log" | tail -30 | tee "$OUT/red-result.txt"
  echo "exit $red" | tee -a "$OUT/red-result.txt"
  # Green: exact head tree.
  git -C "$SRC" reset -q --hard
  head_tree_check
  swift_test --filter "$RELATED" >"$OUT/green.log" 2>&1
  green=$?
  grep -E "RECONNECT_BURST|Test run with|✘|✔.*$TEST_NAME|error:" "$OUT/green.log" | tail -30 | tee "$OUT/green-result.txt"
  echo "exit $green" | tee -a "$OUT/green-result.txt"
  {
    echo "### red: base $BASE + new test only (expect failure)"
    echo '```'; cat "$OUT/red-result.txt"; echo '```'
    echo "### green: head tree $HEAD_TREE"
    echo '```'; cat "$OUT/green-result.txt"; echo '```'
  } | summary
  red_failed_on_new_test=0
  grep -Eq "(✘|failed).*$TEST_NAME" "$OUT/red.log" && red_failed_on_new_test=1
  test "$red" -ne 0 && test "$red_failed_on_new_test" = 1 && test "$green" -eq 0
  exit $?
fi

if [ "$MODE" = full ]; then
  head_tree_check
  swift_test --parallel >"$OUT/full.log" 2>&1
  code=$?
  grep -E "Test run with|Executed [0-9]+ test|error:|✘" "$OUT/full.log" | tail -40 | tee "$OUT/full-result.txt"
  echo "exit $code" | tee -a "$OUT/full-result.txt"
  { echo "### full OpenClawKit swift test on head tree $HEAD_TREE"; echo '```'; cat "$OUT/full-result.txt"; echo '```'; } | summary
  exit "$code"
fi
echo "unknown mode $MODE"
exit 2
