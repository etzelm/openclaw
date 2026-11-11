#!/bin/bash
# Placeholders: SCRIPTS (this directory), WORK (scratch work dir on local disk), BUNDLES (dir with the git bundle of the PR
# head), PNPM_STORE / NPM_CACHE (local caches), BREW_BIN (PostgreSQL 17 binaries), PR_HEAD_REPO (the PR head repository URL).
# Own PostgreSQL 17 for the proof, same settings as the CI conformance action, plus full statement logging.
set -euo pipefail
W=$WORK
export PATH=$BREW_BIN:$PATH LC_ALL=en_US.UTF-8
mkdir -p $W/pg
if [ ! -d $W/pg/data ]; then
  initdb -U postgres -A trust -D $W/pg/data
  cat >> $W/pg/data/postgresql.conf <<EOF
port = 55497
listen_addresses = '127.0.0.1'
max_locks_per_transaction = 512
log_statement = 'all'
log_line_prefix = '%m [%p] '
unix_socket_directories = '$W/pg'
EOF
fi
pg_ctl -D $W/pg/data -l $W/pg/log -w start
psql -h 127.0.0.1 -p 55497 -U postgres -qc "DROP DATABASE IF EXISTS oc_e2e WITH (FORCE)" -c "CREATE DATABASE oc_e2e"
psql -h 127.0.0.1 -p 55497 -U postgres -d oc_e2e -qc 'CREATE EXTENSION unaccent WITH SCHEMA public; CREATE EXTENSION pg_trgm WITH SCHEMA public; CREATE EXTENSION vector WITH SCHEMA public;'
psql -h 127.0.0.1 -p 55497 -U postgres -Atc 'select version()'
