#!/bin/sh
# 2026-11-07 setup: base = current main, head = PR head merged into the same main (throwaway,
# not published). Scratch PostgreSQL 17 on a Unix socket, builds, instrumentation, unit lanes, seed.
# usage: setup.sh <main-sha> <pr-head-sha>
export LC_ALL=en_US.UTF-8 LANG=en_US.UTF-8 CI=1 npm_config_update_notifier=false
W=$HOME/work/bench; MAIN=$1; H=$2; P=$HOME/homebrew/opt/postgresql@17/bin
S=$(dirname "$0")
mkdir -p $W/logs $W/pg $W/scripts $W/results $W/seed && cd $W || exit 1
cp $S/* $W/scripts/ && chmod +x $W/scripts/*.sh
echo "start $(date)"
git clone -q --no-checkout https://github.com/openclaw/openclaw $W/repo > $W/logs/clone.log 2>&1
( cd $W/repo && git fetch -q https://github.com/openclaw/openclaw main:refs/remotes/gh/main refs/pull/190129/head:refs/remotes/gh/pr && git cat-file -e $MAIN && git cat-file -e $H ) >> $W/logs/clone.log 2>&1; echo "clone+fetch rc=$? $(date)"
cd $W/repo && git worktree add -q --detach $W/src-base $MAIN && git worktree add -q --detach $W/src-head $MAIN || exit 1
( cd $W/src-head && git -c user.name=bench -c user.email=bench@invalid merge -q --no-edit $H && echo "head merge rc=0 $(git rev-parse --short=12 HEAD) tree=$(git rev-parse --short=12 HEAD^{tree})" )
cd $W
umask 077
python3 -c 'import secrets;print(secrets.token_hex(16))' > $W/pg/.pw
PW=$(cat $W/pg/.pw)
printf "export OPENCLAW_DATABASE_DSN='postgresql://openclaw_runtime:%s@localhost:55977/openclaw?host=%s/pg/run&sslmode=disable'\n" "$PW" "$W" > $W/scripts/env_dsn.sh
sed "s/PASSWORD '[^']*'/PASSWORD '$PW'/" $W/scripts/pg_init.sql.tmpl > $W/scripts/pg_init.sql
umask 022
$P/initdb -D $W/pg/data -U openclaw --locale=C -E UTF8 > $W/logs/initdb.log 2>&1 || { echo initdb failed; exit 1; }
mkdir -p $W/pg/run $W/pg/log
cat >> $W/pg/data/postgresql.conf <<EOC
listen_addresses = ''
port = 55977
unix_socket_directories = '$W/pg/run'
unix_socket_permissions = 0700
max_connections = 200
max_locks_per_transaction = 512
shared_buffers = 2GB
effective_cache_size = 6GB
work_mem = 16MB
maintenance_work_mem = 1GB
random_page_cost = 1.1
max_wal_size = 2GB
checkpoint_timeout = 15min
jit = off
logging_collector = on
log_directory = '$W/pg/log'
log_filename = 'postgresql.log'
log_line_prefix = '%m [%p] %e %u@%d '
track_io_timing = on
shared_preload_libraries = 'pg_stat_statements'
pg_stat_statements.max = 5000
pg_stat_statements.track = top
EOC
$P/pg_ctl -D $W/pg/data -l $W/logs/pg_ctl.log -w start > /dev/null && echo "PG up $(date)"
$P/psql -h $W/pg/run -p 55977 -U openclaw -d postgres -X -q -v ON_ERROR_STOP=1 -f $W/scripts/pg_init.sql > /dev/null && echo "pg_init ok"
$P/psql -h $W/pg/run -p 55977 -U openclaw -d postgres -X -qAt -c "select version()" > $W/logs/pg-version.log
for s in base head; do
  ( cd $W/src-$s && pnpm install --frozen-lockfile --prefer-offline > $W/logs/build-$s.log 2>&1; echo "$s install rc=$?"; pnpm build >> $W/logs/build-$s.log 2>&1; echo "$s build rc=$? $(date)" )
  sh $W/scripts/instrument.sh $s
done
echo "head dist cap: $(cd $W/src-head/dist && rg -l --max-depth 1 'POSTGRES_SESSION_HISTORY_WORKERS = 4' . | wc -l) files; base: $(cd $W/src-base/dist && rg -l --max-depth 1 'POSTGRES_SESSION_HISTORY_WORKERS' . | wc -l) files"
# Unit lanes: new tests + consumers on head; the two new test files on base (expected red).
T="src/infra/worker-pool-sizing.test.ts src/config/sessions/session-history-lane-sizing.test.ts"
C=""
for f in src/config/sessions/session-transcript-worker-lanes.test.ts src/config/sessions/session-transcript-search.worker.test.ts src/config/sessions/session-transcript-reconcile.readiness.test.ts src/config/sessions/session-history-worker-errors.test.ts src/gateway/server-methods/chat-history-worker.test.ts src/infra/worker-task-pool.preparation.test.ts src/config/sessions/session-transcript-anchor-read.worker.test.ts src/config/sessions/session-transcript-context-read.worker.test.ts src/infra/git-content-budget.test.ts src/state/openclaw-agent-execution.close-wedge.test.ts; do
  [ -f $W/src-head/$f ] && C="$C $f" || echo "consumer missing on main: $f"
done
( cd $W/src-head && node scripts/run-vitest.mjs $T $C > $W/logs/unit-head.log 2>&1; echo "UNIT rc=$? $(date)" >> $W/logs/unit-head.log; tail -1 $W/logs/unit-head.log )
( cd $W/src-base && for f in $T; do cp $W/src-head/$f $f; done && node scripts/run-vitest.mjs $T > $W/logs/unit-base-red.log 2>&1; echo "UNIT rc=$? $(date)" >> $W/logs/unit-base-red.log; rm -f $T; git status --short | head -3; tail -1 $W/logs/unit-base-red.log )
# Seed with the base build: 170 inject sessions, then 30 Claude CLI sessions.
python3 -I $W/scripts/seed_run.py base postgres seed_pg > $W/logs/seed-pg.out 2>&1; echo "seed_pg rc=$? $(date)"
python3 -I $W/scripts/claude_pass.py base postgres seed_pg seed_pgc > $W/logs/seed-pgc.out 2>&1; echo "seed_pgc rc=$? $(date)"
tail -2 $W/logs/seed-pgc.out
echo "SETUP_DONE $(date)"
