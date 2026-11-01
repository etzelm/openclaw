#!/bin/sh
# L3c seed (the 10-28 SQLite snapshot is no longer on the share): restore the
# 2026-10-31 nightly pg_dump of the live store into scratch PG, scrub secrets in
# the copy, and build a fresh home from the matching per-store anchor files.
# usage: prep2.sh <src-name>
export LC_ALL=en_US.UTF-8 LANG=en_US.UTF-8
W=$HOME/work/pg-r2-l3c; S=$1; H=$W/seed/home; O=$H/.openclaw; P=$HOME/homebrew/opt/postgresql@17/bin
B=backups/openclaw
PSQL="$P/psql -h $W/pg/run -p 55936 -U openclaw -X -q -v ON_ERROR_STOP=1"
echo "start $(date)"
mkdir -p $W/inputs/pgb
if [ ! -f $W/inputs/pgb/openclaw.dump ]; then
  $HOME/.openclaw/scripts/nas-get --quiet $B/pg/openclaw.dump $B/pg/namespaces.txt $W/inputs/pgb/ && \
  $HOME/.openclaw/scripts/nas-get --quiet $B/pg/anchors/ $W/inputs/pgb/anchors/; echo "fetch rc=$? $(date)"
fi
$PSQL -d postgres -c "DROP DATABASE IF EXISTS openclaw WITH (FORCE)" && $PSQL -d postgres -c "DROP ROLE IF EXISTS openclaw_runtime" && $PSQL -d postgres -f $W/scripts/pg_init.sql > /dev/null || { echo "pg reset failed"; exit 1; }
$P/pg_restore -l $W/inputs/pgb/openclaw.dump | grep -v -e " EXTENSION " -e " SCHEMA public " > $W/inputs/pgb/restore.list
$P/pg_restore -h $W/pg/run -p 55936 -U openclaw -d openclaw -j 8 -L $W/inputs/pgb/restore.list $W/inputs/pgb/openclaw.dump > $W/logs/seed_restore.log 2>&1; echo "RESTORE rc=$? $(date)"
# scrub secrets (copy only): every restored schema, whichever of these tables it has
$PSQL -d openclaw -At -c "select format('DELETE FROM %I.%I;', table_schema, table_name) from information_schema.tables where table_schema like 'restore_%' and table_name in ('secret_store_entries','auth_profile_store','auth_profile_state','device_auth_tokens','native_exec_socket_credentials','gateway_origin_device_tokens')" > $W/inputs/pgb/scrub.sql
$PSQL -d openclaw -f $W/inputs/pgb/scrub.sql > /dev/null && echo "scrub ok ($(wc -l < $W/inputs/pgb/scrub.sql) tables)"
rm -rf $W/seed && mkdir -p $O && chmod 700 $H
( cd $W/inputs/pgb/anchors && find . -name '*.sqlite.gz' ) | while read f; do
  mkdir -p "$O/$(dirname "$f")" && gunzip -c "$W/inputs/pgb/anchors/$f" > "$O/${f%.gz}" && chmod 600 "$O/${f%.gz}"
done
echo "anchors: $(find $O -name '*.sqlite' | wc -l)"
python3 -I $W/scripts/mkconfig.py $H 19361 postgres > /dev/null
python3 - "$O/openclaw.json" <<'PY'
import json,sys; p=sys.argv[1]; c=json.load(open(p))
c["database"].pop("engine",None); c["agents"].setdefault("defaults",{})["systemAgent"]={"agentId":"main"}; c["plugins"]["allow"].append("team-reports")
json.dump(c,open(p,"w"),indent=1); print("config ok")
PY
chmod -R go-rwx $O
$PSQL -d openclaw -c "VACUUM ANALYZE" && echo "vacuum ok"
echo PREP_DONE
