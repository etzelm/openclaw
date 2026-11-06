#!/bin/bash
# Real-Xcode proof for the chat.send attachment deadline fix.
# Usage: rig/run.sh focused | harness | full
#   focused: base + new test only (expect the new test to fail), then base + full head diff
#            (expect ChatGatewayRequestTests to pass). Same scratch dir, same runner.
#   harness: rig-only harness.diff (throttled NativeGatewayWebSocketFixture + one proof test) sends an
#            8 MB file through GatewayNodeSession.request. Base must time out at 30 s while the
#            frame is still uploading; the exact head tree + harness must get the chat.send ACK.
#   full:    full OpenClawKit swift test on the exact head tree.
set -uo pipefail
MODE="$1"
RIG="$(cd "$(dirname "$0")" && pwd)"
BASE="cb73e59f9356796d4eec6ffeffff327e213355a6"
HEAD_TREE="6f6b08adf9292b4e8a2f8e7b3796fd03de5ae83f"
TEST_NAME="attachment send deadline leaves admission time after a slow upload"
WORK="${RUNNER_TEMP:-/tmp}/send-timeout"
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
  swift_test --filter ChatGatewayRequestTests >"$OUT/red.log" 2>&1
  red=$?
  grep -E "Test run with|✘|Expectation failed|error:" "$OUT/red.log" | tail -30 | tee "$OUT/red-result.txt"
  echo "exit $red" | tee -a "$OUT/red-result.txt"
  # Green: exact head tree.
  git -C "$SRC" reset -q --hard
  head_tree_check
  swift_test --filter ChatGatewayRequestTests >"$OUT/green.log" 2>&1
  green=$?
  grep -E "Test run with|✘|✔.*$TEST_NAME|error:" "$OUT/green.log" | tail -30 | tee "$OUT/green-result.txt"
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

if [ "$MODE" = harness ]; then
  proof_line() { grep -h "SEND_TIMEOUT_PROOF" "$1" | tail -1; }
  # Base: unmodified production code + rig-only harness.
  git -C "$SRC" apply --index "$RIG/harness.diff" || exit 1
  swift_test --filter ChatSendSlowUploadProofTests >"$OUT/base.log" 2>&1
  base=$?
  { proof_line "$OUT/base.log"; grep -E "Test run with|✘|error:" "$OUT/base.log" | tail -10; echo "exit $base"; } | tee "$OUT/base-result.txt"
  # Head: exact head tree + the same harness.
  git -C "$SRC" reset -q --hard
  head_tree_check
  git -C "$SRC" apply --index "$RIG/harness.diff" || exit 1
  swift_test --filter ChatSendSlowUploadProofTests >"$OUT/head.log" 2>&1
  head=$?
  { proof_line "$OUT/head.log"; grep -E "Test run with|✘|✔|error:" "$OUT/head.log" | tail -10; echo "exit $head"; } | tee "$OUT/head-result.txt"
  {
    echo "### harness base $BASE (expect timeout at 30 s while uploading)"
    echo '```'; cat "$OUT/base-result.txt"; echo '```'
    echo "### harness head tree $HEAD_TREE (expect chat.send ACK)"
    echo '```'; cat "$OUT/head-result.txt"; echo '```'
  } | summary
  test "$base" -ne 0 && proof_line "$OUT/base.log" | grep -q "timed out after 30000ms" && test "$head" -eq 0
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
