#!/bin/bash
# Placeholders: SCRIPTS (this directory), WORK (scratch work dir on local disk), BUNDLES (dir with the git bundle of the PR
# head), PNPM_STORE / NPM_CACHE (local caches), BREW_BIN (PostgreSQL 17 binaries), PR_HEAD_REPO (the PR head repository URL).
# Gates at merged head 2278b2ed4b2 (main f7008994ce8) on the then ratchets on plain main. Logs to $W/gates/*-3.log.
set -uo pipefail
W=$WORK
export TMPDIR=$WORK-scratch/tmp npm_config_store_dir=$PNPM_STORE npm_config_cache=$NPM_CACHE LC_ALL=en_US.UTF-8
mkdir -p "$TMPDIR" $W/gates
cd $W/src
git merge --abort 2>/dev/null; git reset -q --hard
git fetch -q $BUNDLES/pc4.bundle pc/196236:refs/heads/pc-head4 && git checkout -q pc-head4 || { echo FAIL checkout; exit 1; }
bash $SCRIPTS/pg-up.sh > $W/gates/pg-up3.log 2>&1 || { echo FAIL pg; exit 1; }
echo "head $(git rev-parse HEAD)" > $W/gates/summary3.txt
psql -h 127.0.0.1 -p 55497 -U postgres -qc "DROP DATABASE IF EXISTS oc_conf WITH (FORCE)" -c "CREATE DATABASE oc_conf"
psql -h 127.0.0.1 -p 55497 -U postgres -d oc_conf -qc 'CREATE EXTENSION unaccent WITH SCHEMA public; CREATE EXTENSION pg_trgm WITH SCHEMA public; CREATE EXTENSION vector WITH SCHEMA public;'
DSN="${CONFORMANCE_DSN:?set CONFORMANCE_DSN to a scratch PostgreSQL DSN for database oc_conf}"
run() { local name=$1; shift; "$@" > $W/gates/$name-3.log 2>&1; echo "$name rc=$?" >> $W/gates/summary3.txt; }
run pg-batch-a node scripts/test-database-conformance.mjs --engine postgres --connection $DSN -- \
  src/infra/database-engine/backup-schema-capture.test.ts src/infra/client-credential-update.test.ts \
  src/infra/database-engine/backup.test.ts src/infra/database-engine/update-cohort-restore.postgres.test.ts \
  src/infra/database-engine/archive-restore.postgres.test.ts src/infra/database-engine/port-provider.test.ts
run pg-batch-b node scripts/test-database-conformance.mjs --engine postgres --connection $DSN -- \
  src/infra/database-engine/doctor-migration.postgres.test.ts
run pg-batch-c node scripts/test-database-conformance.mjs --engine postgres --connection $DSN -- \
  src/infra/database-engine/agent-port.postgres.test.ts src/infra/database-engine/port-command.postgres.test.ts \
  src/infra/database-engine/update-preflight.conformance.test.ts src/state/openclaw-state-db.postgres.test.ts
run unit pnpm test src/infra/database-engine/config.test.ts src/cli/update-cli/update-command-database-retention.test.ts
run config-docs-check pnpm config:docs:check
run config-schema-check pnpm config:schema:check
run baseline-ratchets pnpm check:baseline-ratchets --base f7008994ce853583fc34de73107155e9c2e82e53 --no-merge-base
run check-changed env OPENCLAW_CHECK_CHANGED_REMOTE_CHILD=1 pnpm check:changed --base f7008994ce853583fc34de73107155e9c2e82e53
git checkout -q f7008994ce853583fc34de73107155e9c2e82e53 && run ratchets-plain-main pnpm check:baseline-ratchets --base 2a2eea3fde24410321ecfcc64fb81e4150efb7bc --no-merge-base
echo GATES3_DONE >> $W/gates/summary3.txt
