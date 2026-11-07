#!/bin/sh
# usage: conf.sh <tree> <label> <test files...> : PostgreSQL conformance tests on a separate DB (pc_conf) in the docker PG
W=$HOME/work/pc-190001; T=$1; L=$2; shift 2
DK="docker --context colima-openclaw exec -i pc190001-pg psql -U openclaw -X -q"
$DK -d postgres -c "DROP DATABASE IF EXISTS pc_conf WITH (FORCE)" -c "CREATE DATABASE pc_conf" -c "GRANT CONNECT, CREATE, TEMPORARY ON DATABASE pc_conf TO openclaw_runtime" > /dev/null
$DK -d pc_conf -c "CREATE EXTENSION IF NOT EXISTS vector" -c "CREATE EXTENSION IF NOT EXISTS pg_trgm" -c "CREATE EXTENSION IF NOT EXISTS unaccent" -c "GRANT USAGE, CREATE ON SCHEMA public TO openclaw_runtime" > /dev/null
DSN="[database connection] $W/.pw)@127.0.0.1:55990/pc_conf?sslmode=disable"; unset OPENCLAW_DATABASE_DSN
cd $W/src-$T && CI=1 node scripts/test-database-conformance.mjs --engine postgres --connection "$DSN" -- "$@" > $W/logs/conformance-$L.log 2>&1
echo "CONFORMANCE $L rc=$? $(date)" >> $W/logs/conformance-$L.log
