#!/bin/bash
# Placeholders: SCRIPTS (this directory), WORK (scratch work dir on local disk), BUNDLES (dir with the git bundle of the PR
# head), PNPM_STORE / NPM_CACHE (local caches), BREW_BIN (PostgreSQL 17 binaries), PR_HEAD_REPO (the PR head repository URL).
# Round 2, clone, check out head 9edd6cbabc1, install, pack the head as 2026.11.8 and base main 577da8a944e
# as 2026.11.8 (control, separate dir), start PostgreSQL 17.
set -uo pipefail
HEAD_SHA=9edd6cbabc1adbf6da1251f09f0e9a3dc447b941 BASE=577da8a944e1f834f2920ec49f51fa0be5ada0fb
W=$WORK; S=$BUNDLES
export TMPDIR=$WORK-scratch/tmp npm_config_store_dir=$PNPM_STORE npm_config_cache=$NPM_CACHE LC_ALL=en_US.UTF-8
mkdir -p "$TMPDIR" $W && cd $W
[ -d src/.git ] || git clone -q --no-checkout https://github.com/openclaw/openclaw.git src || { echo FAIL clone; exit 1; }
cd src
git fetch -q $PR_HEAD_REPO feat/postgres-native-captures || { echo FAIL fork; exit 1; }
git fetch -q https://github.com/openclaw/openclaw.git $BASE || { echo FAIL base; exit 1; }
git fetch -q $S/r2.bundle pc/196236:refs/heads/pc-r2 && git checkout -q pc-r2 || { echo FAIL bundle; exit 1; }
[ "$(git rev-parse HEAD)" = $HEAD_SHA ] || { echo FAIL head; exit 1; }
echo "head $(git rev-parse --short HEAD)"
bash $SCRIPTS/pg-up.sh > $W/pg-up.log 2>&1 || { echo FAIL pg; exit 1; }
pnpm install --frozen-lockfile > $W/install.log 2>&1 || { echo INSTALL_FAIL; exit 1; }
pack() { # pack <version> <outdir>
  node -e 'const f="package.json";const p=JSON.parse(require("fs").readFileSync(f,"utf8"));p.version=process.argv[1];require("fs").writeFileSync(f,JSON.stringify(p,null,2)+"\n")' "$1"
  mkdir -p $2
  node scripts/package-openclaw-for-docker.mjs --allow-unreleased-changelog --output-dir $2 > $2.log 2>&1 || { echo "PACK_FAIL $2"; git checkout -q -- .; return 1; }
  git checkout -q -- package.json
  echo "$2: $(cd $2 && ls) sha256 $(shasum -a 256 $2/*.tgz | cut -c1-64) from $(git rev-parse --short HEAD)"
}
pack 2026.11.8 $W/pkg/pr || exit 1
git checkout -q $BASE && git diff --quiet pc-r2 -- pnpm-lock.yaml && echo "lockfile same as head" || pnpm install --frozen-lockfile > $W/install-base.log 2>&1
pack 2026.11.8 $W/pkg/base || exit 1
git checkout -q pc-r2
echo SETUP_DONE
