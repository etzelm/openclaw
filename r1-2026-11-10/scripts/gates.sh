#!/bin/bash
# Placeholders: SCRIPTS (this directory), WORK (scratch work dir on local disk), BUNDLES (dir with the git bundle of the PR
# head), PNPM_STORE / NPM_CACHE (local caches), BREW_BIN (PostgreSQL 17 binaries), PR_HEAD_REPO (the PR head repository URL).
# Gates at the head on the . Logs to $W/gates/.
set -uo pipefail
W=$WORK
export TMPDIR=$WORK-scratch/tmp npm_config_store_dir=$PNPM_STORE npm_config_cache=$NPM_CACHE LC_ALL=en_US.UTF-8
mkdir -p "$TMPDIR" $W/gates
cd $W/src
echo "head $(git rev-parse HEAD)" > $W/gates/summary.txt
psql -h 127.0.0.1 -p 55497 -U postgres -qc "DROP DATABASE IF EXISTS oc_conf WITH (FORCE)" -c "CREATE DATABASE oc_conf"
psql -h 127.0.0.1 -p 55497 -U postgres -d oc_conf -qc 'CREATE EXTENSION unaccent WITH SCHEMA public; CREATE EXTENSION pg_trgm WITH SCHEMA public; CREATE EXTENSION vector WITH SCHEMA public;'
DSN="${CONFORMANCE_DSN:?set CONFORMANCE_DSN to a scratch PostgreSQL DSN for database oc_conf}"
run() { local name=$1; shift; "$@" > $W/gates/$name.log 2>&1; echo "$name rc=$?" >> $W/gates/summary.txt; }
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
run baseline-ratchets pnpm check:baseline-ratchets --base 277e32c668a95579e3fc554b5aacf8973c33629e --no-merge-base
run check-changed env OPENCLAW_CHECK_CHANGED_REMOTE_CHILD=1 pnpm check:changed --base 277e32c668a95579e3fc554b5aacf8973c33629e
echo GATES_DONE >> $W/gates/summary.txt
