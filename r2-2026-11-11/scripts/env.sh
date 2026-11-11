# Isolated e2e environment for the PR 196236 rollback proof. Source me.
# Placeholders: SCRIPTS (this directory), WORK (scratch work dir on local disk), BUNDLES (dir with the git bundle of the PR
# head), PNPM_STORE / NPM_CACHE (local caches), BREW_BIN (PostgreSQL 17 binaries), PR_HEAD_REPO (the PR head repository URL).
W=$WORK
E=$W/e2e
for v in $(env | sed -n "s/^\(OPENCLAW_[A-Z_]*\)=.*/\1/p"); do unset "$v"; done
export HOME=$E/home
export NPM_CONFIG_PREFIX=$E/prefix
export NPM_CONFIG_CACHE=$E/npm-cache
export TMPDIR=$E/tmp npm_config_store_dir=$PNPM_STORE
export PATH=$E/prefix/bin:$BREW_BIN:/usr/bin:/bin:/usr/sbin:/sbin
export LC_ALL=en_US.UTF-8
export PGPORT=55497
export OPENCLAW_PG="${OPENCLAW_PG:?set OPENCLAW_PG to a scratch PostgreSQL DSN (<dsn>, database oc_e2e)}"
pgq() { psql "$OPENCLAW_PG" -AtF ' | ' -c "$1"; }
pgcaps() { pgq "SELECT nspname, coalesce(left(obj_description(oid,'pg_namespace'),140),'(no marker)') FROM pg_namespace WHERE nspname ~ '^(restore_|openclaw_)' ORDER BY 1"; }
redact() { sed -e "s#$E#<e2e>#g" -e "s#$W#<w>#g" -e 's#postgresql://[^ ]*#<dsn>#g'; }
