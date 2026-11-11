#!/bin/bash
# Placeholders: SCRIPTS (this directory), WORK (scratch work dir on local disk), BUNDLES (dir with the git bundle of the PR
# head), PNPM_STORE / NPM_CACHE (local caches), BREW_BIN (PostgreSQL 17 binaries), PR_HEAD_REPO (the PR head repository URL).
# Pack the PR head twice: 2026.11.8 = head as committed (the installed updater),
# 2026.11.9 = head plus one injected failure in the candidate's update Doctor (the only synthetic step).
set -euo pipefail
export LC_ALL=en_US.UTF-8
W=$WORK
cd $W/src
git diff --quiet && git diff --cached --quiet || { echo "tree not clean"; exit 1; }
echo "head $(git rev-parse HEAD)"
pack() {
  local v=$1
  node -e 'const f="package.json";const p=JSON.parse(require("fs").readFileSync(f,"utf8"));p.version=process.argv[1];require("fs").writeFileSync(f,JSON.stringify(p,null,2)+"\n")' "$v"
  mkdir -p $W/pkg/$v
  node scripts/package-openclaw-for-docker.mjs --allow-unreleased-changelog --output-dir $W/pkg/$v > $W/pack-$v.log 2>&1 || { echo "PACK_FAIL $v"; git checkout -q -- .; exit 1; }
  git checkout -q -- package.json
  echo "$v: $(ls $W/pkg/$v) sha256 $(shasum -a 256 $W/pkg/$v/*.tgz | cut -c1-64)"
}
[ "${ONLY:-}" = 2026.11.9 ] || pack 2026.11.8
git apply $SCRIPTS/candidate-doctor-fault.patch
git diff --stat
pack 2026.11.9
git checkout -q -- .
git status --short | head
echo PACK2_DONE
