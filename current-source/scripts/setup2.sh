#!/bin/sh
# Round 2 setup: base = 3c130c7268e1 (new head's main parent), fix = 213409bf (new head).
# PostgreSQL 17 (pgvector) and toxiproxy on one docker network; the Gateway connects through toxiproxy.
export LC_ALL=en_US.UTF-8 LANG=en_US.UTF-8 CI=1 npm_config_update_notifier=false
W=$HOME/work/pc-190001; S=<home>/nas/outputs/pr-campaign-2026-11-06/P190001/scripts
BASE=3c130c7268e1ea058c5ce93a4fd5d8301dbdabfa; FIX=213409bffb787fead9e88021e2b4900b8db4ac5a
DK="docker --context colima-openclaw"
mkdir -p $W/logs $W/scripts && cd $W || exit 1
cp $S/* $W/scripts/; chmod +x $W/scripts/*.sh
echo "start $(date)"
GIT_SSH_COMMAND="ssh -i $HOME/.ssh/id_nas_localhost -o IdentitiesOnly=yes -o BatchMode=yes" git clone -q --no-checkout openclaw@127.0.0.1:<home>/nas/repos/openclaw $W/repo > $W/logs/clone.log 2>&1
( cd $W/repo && git fetch -q https://github.com/openclaw/openclaw main:refs/remotes/gh/main refs/pull/190001/head:refs/remotes/gh/pr && git fetch -q <home>/nas/scratch/2026-11-06/pc-190001/pc.bundle HEAD:refs/heads/pc-new ) >> $W/logs/clone.log 2>&1; echo "clone rc=$? $(date)"
cd $W/repo && git worktree add -q --detach $W/src-base $BASE && git worktree add -q --detach $W/src-fix $FIX || exit 1
umask 077; python3 -c 'import secrets;print(secrets.token_hex(16))' > $W/.pw; umask 022; PW=$(cat $W/.pw)
$DK rm -f pc190001-pg pc190001-toxi > /dev/null 2>&1; $DK network rm pc190001-net > /dev/null 2>&1
$DK network create pc190001-net > /dev/null && echo "net ok"
$DK run -d --name pc190001-pg --network pc190001-net -p 127.0.0.1:55990:5432 -e POSTGRES_USER=openclaw -e POSTGRES_PASSWORD=$PW \
  --shm-size=1g pgvector/pgvector:pg17 -c max_connections=200 -c max_locks_per_transaction=512 -c shared_buffers=1GB \
  -c "log_line_prefix=%m [%p] %e %u@%d " -c shared_preload_libraries=pg_stat_statements -c jit=off > $W/logs/docker.log 2>&1; echo "pg rc=$?"
$DK run -d --name pc190001-toxi --network pc190001-net -p 127.0.0.1:55991:55991 -p 127.0.0.1:58474:8474 ghcr.io/shopify/toxiproxy:2.12.0 >> $W/logs/docker.log 2>&1; echo "toxi rc=$?"
for i in $(seq 60); do $DK exec pc190001-pg pg_isready -U openclaw -q && break; sleep 2; done
sed "s/PASSWORD '[^']*'/PASSWORD '$PW'/" $W/scripts/pg_init.sql.tmpl | $DK exec -i pc190001-pg psql -U openclaw -d postgres -X -q > $W/logs/pg_init.log 2>&1
sleep 2; curl -s -X POST localhost:58474/proxies -d '{"name":"pg","listen":"0.0.0.0:55991","upstream":"pc190001-pg:5432","enabled":true}'; echo
umask 077; printf "export OPENCLAW_DATABASE_DSN='postgresql://openclaw_runtime:%s@127.0.0.1:55991/openclaw?sslmode=disable'\n" "$PW" > $W/scripts/env_dsn.sh; umask 022
( cd $W/src-base && pnpm install --frozen-lockfile --prefer-offline > $W/logs/install-base.log 2>&1; echo "base install rc=$?"; pnpm build > $W/logs/build-base.log 2>&1; echo "base build rc=$? $(date)" ) &
( cd $W/src-fix && pnpm install --frozen-lockfile --prefer-offline > $W/logs/install-fix.log 2>&1; echo "fix install rc=$?"; pnpm build > $W/logs/build-fix.log 2>&1; echo "fix build rc=$? $(date)" ) &
wait
echo "SETUP_DONE $(date)"
