#!/usr/bin/env bash
# Usage: run-arm.sh <arm-label> <repo-root> <out-dir> <observer.mjs>
# Records the arm's identity, then runs gateway-reply-proof.mts from the arm's
# repo root against that arm's built dist/ (OPENCLAW_BUILD_PRIVATE_QA=1 pnpm build).
set -u
label="$1"; repo="$2"; out="$3"; observer="$4"
mkdir -p "$out"
{
  echo "arm: $label"
  echo "date: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "node: $(node --version)"
  echo "HEAD: $(git -C "$repo" rev-parse HEAD)"
  echo "uncommitted changes (proof patch only):"
  git -C "$repo" status --short --untracked-files=no
  echo "built reply lookup status clause in dist/:"
  grep -rn -A4 '\.where("delivery\.status", "in"' "$repo/dist" --include='*.mjs' --include='*.js' | sed "s|$repo/||"
} > "$out/arm.txt" 2>&1
cd "$repo" || exit 1
node --import ./scripts/tsx.mjs scripts/gateway-reply-proof.mts "$out" "$observer" > "$out/console.log" 2>&1
code=$?
echo "driver exit: $code" >> "$out/arm.txt"
exit $code
