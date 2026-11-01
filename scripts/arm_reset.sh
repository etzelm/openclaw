#!/bin/sh
# usage: arm_reset.sh <engine> <seed> <arm-label> : fresh openclaw DB from template <seed> (postgres) + fresh home copy
export LC_ALL=en_US.UTF-8 LANG=en_US.UTF-8
W=$HOME/work/pg-r2-l3d; P=$HOME/homebrew/opt/postgresql@17/bin
if [ "$1" = postgres ]; then
  PSQL="$P/psql -h $W/pg/run -p 55937 -U openclaw -X -q -v ON_ERROR_STOP=1 -d postgres"
  $PSQL -c "DROP DATABASE IF EXISTS openclaw WITH (FORCE)" -c "CREATE DATABASE openclaw TEMPLATE $2" -c "REVOKE ALL ON DATABASE openclaw FROM PUBLIC" -c "GRANT CONNECT, CREATE, TEMPORARY ON DATABASE openclaw TO openclaw_runtime" && \
    $P/psql -h $W/pg/run -p 55937 -U openclaw -X -q -d openclaw -c "select pg_stat_statements_reset()" -c "select pg_stat_reset()" > /dev/null || exit 1
fi
rm -rf $W/inst/$3 && mkdir -p $W/inst/$3 && cp -Rc $W/seed/home-$2 $W/inst/$3/home && chmod 700 $W/inst/$3/home && echo "reset ok $1 $2 -> $3"
