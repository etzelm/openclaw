#!/bin/bash
# Full OpenClawKit `swift test` on one lane's exact head tree, unmodified, with Xcode.
# Usage: rig/full-suite.sh <lane>
set -uo pipefail
LANE="$1"
RIG="$(cd "$(dirname "$0")" && pwd)"
WORK="${RUNNER_TEMP:-/tmp}/chatui-full"
OUT="${PROOF_OUT:-$WORK/out}/$LANE-full"
mkdir -p "$WORK" "$OUT"
field() { python3 -I -c 'import json,sys; print(json.load(open(sys.argv[1]))[sys.argv[2]][sys.argv[3]])' "$RIG/lanes.json" "$LANE" "$1"; }
BASE="$(field base)"
HEAD_TREE="$(field headTree)"
SRC="$WORK/src"
rm -rf "$SRC"
git init -q "$SRC"
git -C "$SRC" fetch -q --depth 1 https://github.com/openclaw/openclaw.git "$BASE" || exit 1
git -C "$SRC" checkout -q --detach FETCH_HEAD
git -C "$SRC" apply --index "$RIG/lanes/$LANE.diff" || exit 1
tree="$(git -C "$SRC" write-tree)"
echo "head tree $tree (expected $HEAD_TREE)" | tee "$OUT/environment.txt"
test "$tree" = "$HEAD_TREE" || exit 1
{ xcodebuild -version; swift --version 2>&1; sw_vers; sysctl -n hw.ncpu; } | tee -a "$OUT/environment.txt"
cd "$SRC" || exit 1
pnpm install --frozen-lockfile --prefer-offline --optional \
  --filter '@openclaw/mermaid-renderer...' --filter '@openclaw/gateway-protocol...' \
  --config.ignore-scripts=false --config.engine-strict=false \
  --config.enable-pre-post-scripts=true >"$OUT/pnpm.log" 2>&1 || { tail -40 "$OUT/pnpm.log"; exit 1; }
node scripts/prepare-apple-mermaid.mjs >"$OUT/mermaid.log" 2>&1 || { tail -40 "$OUT/mermaid.log"; exit 1; }
swift test --package-path apps/shared/OpenClawKit --scratch-path "$WORK/scratch" \
  --disable-index-store -Xswiftc -gline-tables-only --parallel >"$OUT/swift-test.log" 2>&1
code=$?
grep -E "Test run with|Executed [0-9]+ test|error:|✘" "$OUT/swift-test.log" | tail -40 | tee "$OUT/result.txt"
echo "exit $code" | tee -a "$OUT/result.txt"
{
  echo "### $LANE full OpenClawKit swift test on head tree $HEAD_TREE"
  echo '```'
  cat "$OUT/result.txt"
  echo '```'
} >>"${GITHUB_STEP_SUMMARY:-/dev/null}"
exit "$code"
