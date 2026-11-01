#!/bin/sh
# usage: conformance.sh <tree: base|fix> <label> <test files...> : PostgreSQL conformance tests on a separate DB (l3c_conf)
W=$HOME/work/pg-r2-l3c; P=$HOME/homebrew/opt/postgresql@17/bin; T=$1; L=$2; shift 2
Q="$P/psql -h $W/pg/run -p 55936 -U openclaw -X -q -d postgres"
$Q -c "DROP DATABASE IF EXISTS l3c_conf WITH (FORCE)" -c "CREATE DATABASE l3c_conf" -c "GRANT CONNECT, CREATE, TEMPORARY ON DATABASE l3c_conf TO openclaw_runtime" > /dev/null
$P/psql -h $W/pg/run -p 55936 -U openclaw -X -q -d l3c_conf -c "CREATE EXTENSION IF NOT EXISTS vector" -c "CREATE EXTENSION IF NOT EXISTS pg_trgm" -c "CREATE EXTENSION IF NOT EXISTS unaccent" -c "GRANT USAGE, CREATE ON SCHEMA public TO openclaw_runtime" > /dev/null
# the catalog pre-check sets track_functions, so the scratch superuser (socket, trust auth, no password) runs it
DSN="postgresql://openclaw@localhost/l3c_conf?host=$W/pg/run&port=55936"; unset OPENCLAW_DATABASE_DSN
mkdir -p $W/redgreen
cd $W/src-$T && CI=1 node scripts/test-database-conformance.mjs --engine postgres --connection "$DSN" -- "$@" > $W/redgreen/conformance-$L.log 2>&1
echo "CONFORMANCE $L rc=$? $(date)" | tee -a $W/redgreen/conformance-$L.log
