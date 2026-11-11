#!/bin/bash
# Placeholders: SCRIPTS (this directory), WORK (scratch work dir on local disk), BUNDLES (dir with the git bundle of the PR
# head), PNPM_STORE / NPM_CACHE (local caches), BREW_BIN (PostgreSQL 17 binaries), PR_HEAD_REPO (the PR head repository URL).
# Pack head 9edd6cbabc1 again as 2026.11.9 (unmodified), the update candidate for the server-capture update after the npm upgrade.
set -uo pipefail
W=$WORK
export TMPDIR=$WORK-scratch/tmp npm_config_store_dir=$PNPM_STORE npm_config_cache=$NPM_CACHE LC_ALL=en_US.UTF-8
cd $W/src && git checkout -q pc-r2 && [ "$(git rev-parse HEAD)" = 9edd6cbabc1adbf6da1251f09f0e9a3dc447b941 ] || { echo FAIL head; exit 1; }
git diff --quiet || { echo FAIL dirty; exit 1; }
node -e 'const f="package.json";const p=JSON.parse(require("fs").readFileSync(f,"utf8"));p.version="2026.11.9";require("fs").writeFileSync(f,JSON.stringify(p,null,2)+"\n")'
mkdir -p $W/pkg/pr9
node scripts/package-openclaw-for-docker.mjs --allow-unreleased-changelog --output-dir $W/pkg/pr9 > $W/pkg/pr9.log 2>&1 || { echo PACK_FAIL; git checkout -q -- .; exit 1; }
git checkout -q -- package.json
echo "pr9: $(cd $W/pkg/pr9 && ls) sha256 $(shasum -a 256 $W/pkg/pr9/*.tgz | cut -c1-64) from $(git rev-parse --short HEAD)"
echo PACK9_DONE
