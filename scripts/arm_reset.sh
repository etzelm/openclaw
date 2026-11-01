#!/bin/sh
# usage: arm_reset.sh <seeddb> <arm-label> : fresh openclaw DB from template + fresh home copy
export LC_ALL=en_US.UTF-8 LANG=en_US.UTF-8
W=$HOME/work/pg-r2-l3c; P=$HOME/homebrew/opt/postgresql@17/bin
PSQL="$P/psql -h $W/pg/run -p 55936 -U openclaw -X -q -v ON_ERROR_STOP=1 -d postgres"
$PSQL -c "DROP DATABASE IF EXISTS openclaw WITH (FORCE)" -c "CREATE DATABASE openclaw TEMPLATE $1" -c "REVOKE ALL ON DATABASE openclaw FROM PUBLIC" -c "GRANT CONNECT, CREATE, TEMPORARY ON DATABASE openclaw TO openclaw_runtime" && \
  $P/psql -h $W/pg/run -p 55936 -U openclaw -X -q -d openclaw -c "select pg_stat_statements_reset()" -c "select pg_stat_reset()" > /dev/null || exit 1
rm -rf $W/inst/$2 && mkdir -p $W/inst/$2 && cp -Rc $W/seed/home-$1 $W/inst/$2/home && chmod 700 $W/inst/$2/home && echo "reset ok $1 -> $2"
# priming boot: the first boot on a freshly copied home fails at bootstrap with
# "PostgreSQL connections must run in a worker" (before plugins load); the next boot is clean.
if [ -n "$3" ]; then $W/scripts/boot_test.sh $3 $W/inst/$2/home 60 $W/logs/prime_$2_$3_$(date +%H%M%S).log | head -1 | sed 's/^/prime boot: /'; fi
