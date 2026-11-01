#!/bin/sh
# Rebuild the restored seed with every fidelity fix (stops on the first failure).
set -e
W=$HOME/work/pg-r2-l3c; H=$W/seed/home; O=$H/.openclaw; P=$HOME/homebrew/opt/postgresql@17/bin
Q="$P/psql -h $W/pg/run -p 55936 -U openclaw -X -q -v ON_ERROR_STOP=1"
echo "start $(date)"
$Q -d postgres -c "DROP DATABASE IF EXISTS seed_a WITH (FORCE)" -c "DROP DATABASE IF EXISTS fresh WITH (FORCE)" -c "DROP DATABASE IF EXISTS l3c_conf WITH (FORCE)"
sh $W/scripts/prep2.sh base > $W/logs/prep_seed.log 2>&1; tail -3 $W/logs/prep_seed.log
S=restore_0f8f2eeae0994803b2000caa81bce35a
$Q -d openclaw -c "delete from $S.state_leases where scope='gateway-owner'"
$Q -d openclaw -f $W/scripts/fix_restore_checks.sql
$W/src-live/node_modules/.bin/tsx $W/scripts/reseal_fp.mts $W/src-live $W/pg/run 55936 openclaw | wc -l
gunzip -c $W/inputs/pgb/client-credentials.sqlite.gz > $O/client/credentials.sqlite 2>/dev/null || { mkdir -p $O/client; gunzip -c $W/inputs/pgb/client-credentials.sqlite.gz > $O/client/credentials.sqlite; }
sqlite3 $O/client/credentials.sqlite "DELETE FROM device_auth_tokens; DELETE FROM native_exec_socket_credentials; DELETE FROM gateway_origin_device_tokens;"
chmod 600 $O/client/credentials.sqlite; chmod 700 $O/client $O $H
python3 - "$O/openclaw.json" <<'PY'
import json,sys; p=sys.argv[1]; c=json.load(open(p)); c["database"]["engine"]="postgres"; c.pop("memory",None); json.dump(c,open(p,"w"),indent=1); print("config ok")
PY
for i in 1 2; do echo "live boot $i: $($W/scripts/boot_test.sh live $H 240 $W/logs/restore_boot$i.log 2>/dev/null | head -1)"; done
$Q -d postgres -c "CREATE DATABASE seed_live TEMPLATE openclaw" 2>/dev/null || $Q -d postgres -c "DROP DATABASE seed_live" -c "CREATE DATABASE seed_live TEMPLATE openclaw"
rm -rf $W/seed/home-live && cp -Rc $H $W/seed/home-live
echo "STAGE_RESTORE_DONE $(date)"
