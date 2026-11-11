#!/bin/bash
# Placeholders: SCRIPTS (this directory), WORK (scratch work dir on local disk), BUNDLES (dir with the git bundle of the PR
# head), PNPM_STORE / NPM_CACHE (local caches), BREW_BIN (PostgreSQL 17 binaries), PR_HEAD_REPO (the PR head repository URL).
# 1) dead export scan on plain main (same tree, deps already installed), 2) gates for the two new commits.
set -uo pipefail
W=$WORK
export TMPDIR=$WORK-scratch/tmp npm_config_store_dir=$PNPM_STORE npm_config_cache=$NPM_CACHE LC_ALL=en_US.UTF-8
mkdir -p "$TMPDIR"
cd $W/src
git worktree remove --force ../mainwt 2>/dev/null
G=$W/gates; s=$G/summary2.txt
run() { local name=$1; shift; "$@" > $G/$name.log 2>&1; echo "$name rc=$?" >> $s; }
git checkout -q 277e32c668a95579e3fc554b5aacf8973c33629e && echo "main $(git rev-parse --short HEAD)" > $s
run deadcode-main pnpm deadcode:exports
git fetch -q $BUNDLES/pc2.bundle pc/196236:refs/heads/pc-head2 && git checkout -q pc-head2
echo "head $(git rev-parse HEAD)" >> $s
run baseline-ratchets2 pnpm check:baseline-ratchets --base 277e32c668a95579e3fc554b5aacf8973c33629e --no-merge-base
run docs-mdx pnpm docs:check-mdx
run docs-links pnpm docs:check-links
run format-docs pnpm exec oxfmt --check docs/gateway/postgresql.md docs/reference/database-engines.md config/test-lines-allocations/196155-postgres-schema-captures.txt
run check-changed2 env OPENCLAW_CHECK_CHANGED_REMOTE_CHILD=1 pnpm check:changed --base 277e32c668a95579e3fc554b5aacf8973c33629e
echo GATES2_DONE >> $s
