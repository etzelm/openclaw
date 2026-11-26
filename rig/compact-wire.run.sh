#!/usr/bin/env bash
set -euo pipefail
candidate=$1
expected=$2
out=$3
rig=$(cd -- "$(dirname -- "$0")" && pwd -P)
proof="$rig/pr204133-compact-wire.mjs"
[[ "$candidate" = /* && "$out" = /* && "$expected" =~ ^[a-f0-9]{40}$ ]]
cd -- "$candidate"
test "$(git rev-parse --show-toplevel)" = "$candidate"
test "$(git rev-parse HEAD)" = "$expected"
git diff --quiet HEAD --
node "$proof" --self-test
scratch=$(mktemp -d "${TMPDIR:?}/pr204133.XXXXXX")
trap 'rm -rf -- "$scratch"' EXIT
mkdir "$scratch/launcher-home"
for profile in base small; do
  timeout --kill-after=10s 145s env -i PATH="$PATH" HOME="$scratch/launcher-home" TMPDIR="$scratch" CI=1 \
    node --import ./scripts/tsx.mjs "$proof" "$profile" "$scratch" "$expected" > "$scratch/$profile.stdout"
  grep '^PR204133_WIRE_PROOF ' "$scratch/$profile.stdout" | cut -c20- > "$scratch/$profile.json"
  test "$(wc -l < "$scratch/$profile.json")" -eq 1
  jq -e --arg head "$expected" --arg prof "openclaw/$profile" '.head == $head and .profile == $prof and .ingress == "getReplyFromConfig" and (.capture.sha256 | test("^[a-f0-9]{64}$")) and (.capture.bytes > 0) and (.inputRows | length == 3) and (.capture.rows | length == (if $prof == "openclaw/base" then 3 else 2 end))' "$scratch/$profile.json" >/dev/null
done
mkdir -p "$out"
jq -s '{head: .[0].head, captures: .}' "$scratch/base.json" "$scratch/small.json" > "$out/compact-wire-verification.json"
