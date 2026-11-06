#!/bin/bash
# Prepare one source tree for the bg-outbox-flush proof.
#   base        upstream base, unmodified
#   base-tests  upstream base plus only the new OpenClawKit test file (red-before)
#   head        upstream base plus the full PR diff, tree checked against lane.json
# Usage: rig/source.sh <side> <dest-dir> [--native-assets]
set -euo pipefail
SIDE="$1"
SRC="$2"
RIG="$(cd "$(dirname "$0")" && pwd)"
field() { python3 -I -c 'import json,sys; print(json.load(open(sys.argv[1]))[sys.argv[2]])' "$RIG/lane.json" "$1"; }
BASE="$(field base)"
HEAD_TREE="$(field headTree)"

rm -rf "$SRC"
git init -q "$SRC"
git -C "$SRC" fetch -q --depth 1 https://github.com/openclaw/openclaw.git "$BASE"
git -C "$SRC" checkout -q --detach FETCH_HEAD
test "$(git -C "$SRC" rev-parse HEAD)" = "$BASE"
case "$SIDE" in
  base) ;;
  base-tests) git -C "$SRC" apply --index "$RIG/bg-outbox-flush-tests-only.diff" ;;
  head)
    git -C "$SRC" apply --index "$RIG/bg-outbox-flush.diff"
    tree="$(git -C "$SRC" write-tree)"
    echo "head tree $tree (expected $HEAD_TREE)"
    test "$tree" = "$HEAD_TREE"
    ;;
  *) echo "unknown side $SIDE" >&2; exit 2 ;;
esac
echo "$SIDE: base $BASE, tree $(git -C "$SRC" write-tree)"

if [ "${3:-}" = "--native-assets" ]; then
  (
    cd "$SRC"
    pnpm install --frozen-lockfile --prefer-offline --optional \
      --filter . --filter '@openclaw/mermaid-renderer...' --filter '@openclaw/gateway-protocol...' \
      --config.ignore-scripts=false --config.engine-strict=false \
      --config.enable-pre-post-scripts=true >"$SRC/../pnpm-$SIDE.log" 2>&1 ||
      { tail -40 "$SRC/../pnpm-$SIDE.log"; exit 1; }
    node scripts/prepare-apple-mermaid.mjs >"$SRC/../mermaid-$SIDE.log" 2>&1 ||
      { tail -40 "$SRC/../mermaid-$SIDE.log"; exit 1; }
  )
fi
