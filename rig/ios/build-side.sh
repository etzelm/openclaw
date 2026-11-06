#!/bin/bash
# Build the shipped iOS app (OpenClawUITests scheme, Debug, iOS Simulator) for one side of lane p1,
# with the identical scratch fixture/probes applied to base and head.
# Usage: rig/ios/build-side.sh base|head
set -uo pipefail
SIDE="$1"
RIG="$(cd "$(dirname "$0")/.." && pwd)"
WORK="${RUNNER_TEMP:-/tmp}/ios-proof"
OUT="$WORK/out"
LOG="$OUT/logs"
SRC="$WORK/src"
mkdir -p "$LOG"
field() { python3 -I -c 'import json,sys; print(json.load(open(sys.argv[1]))["p1"][sys.argv[2]])' "$RIG/lanes.json" "$1"; }
BASE="$(field base)"
HEAD_TREE="$(field headTree)"
step() { echo "::group::$*"; echo "=== $(date -u +%H:%M:%S) $*"; }
endstep() { echo "::endgroup::"; }
die() { echo "::error::$*"; echo "FAILED: $*" >>"$OUT/status-$SIDE.txt"; exit 1; }

step "source ($SIDE)"
rm -rf "$SRC"
git init -q "$SRC"
git -C "$SRC" fetch -q --depth 1 https://github.com/openclaw/openclaw.git "$BASE" || die "fetch base"
git -C "$SRC" checkout -q --detach FETCH_HEAD
test "$(git -C "$SRC" rev-parse HEAD)" = "$BASE" || die "base sha mismatch"
if [ "$SIDE" = head ]; then
  git -C "$SRC" apply --index "$RIG/lanes/p1.diff" || die "head diff does not apply"
  tree="$(git -C "$SRC" write-tree)"
  echo "head tree $tree (expected $HEAD_TREE)"
  test "$tree" = "$HEAD_TREE" || die "head tree mismatch"
fi
git -C "$SRC" -c user.name=proof -c user.email=proof@invalid commit -q --allow-empty -m "$SIDE"
echo "$SIDE: base $BASE, tree $(git -C "$SRC" rev-parse 'HEAD^{tree}')" | tee "$OUT/source-$SIDE.txt"
endstep

step "scratch fixture and probes ($SIDE)"
python3 -I "$RIG/ios/patch_app.py" "$SRC" || die "patch_app"
python3 -I "$RIG/instrument.py" "$SRC/apps/shared/OpenClawKit/Sources/OpenClawChatUI" "$RIG/ChatPerfProbe.swift" \
  | tee "$OUT/probes-$SIDE.txt" || die "instrument"
git -C "$SRC" add -N . && git -C "$SRC" diff >"$OUT/instrumentation-$SIDE.diff"
endstep

step "tools"
TOOLS="$WORK/tools"
(cd "$SRC" && ./scripts/install-xcodegen.sh "$TOOLS") >"$LOG/tools-$SIDE.log" 2>&1 || { tail -20 "$LOG/tools-$SIDE.log"; die "xcodegen"; }
export PATH="$TOOLS:$HOME/.cargo/bin:$PATH"
watch_toolchain="$(awk -F '"' '/^channel =/ { print $2; exit }' "$SRC/apps/shared/OpenClawWatchRTC/rust-toolchain.toml")"
rustup toolchain install "$watch_toolchain" --profile minimal --component rust-src >>"$LOG/tools-$SIDE.log" 2>&1 ||
  { tail -20 "$LOG/tools-$SIDE.log"; die "rust toolchain"; }
endstep

step "node deps, Mermaid assets, xcodegen ($SIDE)"
(
  cd "$SRC" || exit 1
  pnpm install --frozen-lockfile --prefer-offline --optional \
    --filter . --filter '@openclaw/mermaid-renderer...' --filter '@openclaw/gateway-protocol...' \
    --config.ignore-scripts=false --config.engine-strict=false \
    --config.enable-pre-post-scripts=true >"$LOG/pnpm-$SIDE.log" 2>&1 &&
    node scripts/prepare-apple-mermaid.mjs >"$LOG/mermaid-$SIDE.log" 2>&1 &&
    pnpm ios:gen >"$LOG/iosgen-$SIDE.log" 2>&1
) || { tail -30 "$LOG/pnpm-$SIDE.log" "$LOG/mermaid-$SIDE.log" "$LOG/iosgen-$SIDE.log" 2>/dev/null; die "deps/gen"; }
endstep

step "xcodebuild build-for-testing ($SIDE)"
{ xcodebuild -version; swift --version 2>&1 | head -1; sw_vers; } | tee "$OUT/toolchain-$SIDE.txt"
started=$(date +%s)
perl -e 'alarm shift; exec @ARGV' 3600 xcodebuild \
  -project "$SRC/apps/ios/OpenClaw.xcodeproj" -scheme OpenClawUITests -configuration Debug \
  -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath "$WORK/dd" -clonedSourcePackagesDirPath "$WORK/spm" \
  ARCHS="$(uname -m)" ONLY_ACTIVE_ARCH=YES COMPILER_INDEX_STORE_ENABLE=NO \
  -showBuildTimingSummary build-for-testing >"$LOG/build-$SIDE.log" 2>&1
rc=$?
echo "build exit $rc after $(( $(date +%s) - started )) s" | tee -a "$OUT/toolchain-$SIDE.txt"
if [ $rc -ne 0 ]; then
  grep -E "error:|\*\* BUILD|FAILED" "$LOG/build-$SIDE.log" | head -40
  die "xcodebuild $rc"
fi
endstep

step "package products ($SIDE)"
(cd "$WORK/dd/Build/Products" && ls && tar -czf "$WORK/products-$SIDE.tgz" .) || die "tar products"
ls -la "$WORK/products-$SIDE.tgz"
endstep
