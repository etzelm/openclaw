#!/bin/bash
# Placeholders: SCRIPTS (this directory), WORK (scratch work dir on local disk), BUNDLES (dir with the git bundle of the PR
# head), PNPM_STORE / NPM_CACHE (local caches), BREW_BIN (PostgreSQL 17 binaries), PR_HEAD_REPO (the PR head repository URL).
# Usage: rollback-e2e.sh <label> <portable|server>
# Fresh isolated install of the head (2026.11.8), Workboard ported to PostgreSQL, then a real
# `openclaw update` to the 2026.11.9 candidate. The candidate's update Doctor fails when the harness
# marker exists (scripts/candidate-doctor-fault.patch); the installed 2026.11.8 updater captures and restores.
set -uo pipefail
S=$SCRIPTS
source $S/env.sh
label=$1 mode=$2
out=$W/out/$label
rm -rf "$E" "$out" && mkdir -p "$E/home" "$E/prefix" "$E/tmp" "$out"
psql -h 127.0.0.1 -p $PGPORT -U postgres -qc "DROP DATABASE IF EXISTS oc_e2e WITH (FORCE)" -c "CREATE DATABASE oc_e2e"
psql -h 127.0.0.1 -p $PGPORT -U postgres -d oc_e2e -qc 'CREATE EXTENSION unaccent WITH SCHEMA public; CREATE EXTENSION pg_trgm WITH SCHEMA public; CREATE EXTENSION vector WITH SCHEMA public;'
npm install -g $W/pkg/2026.11.8/openclaw-2026.11.8.tgz --allow-scripts=openclaw > $out/npm-install.log 2>&1
pglog=$W/pg/log
ANCHOR=$HOME/.openclaw/plugins/workboard/workboard.sqlite
anchor() { sqlite3 "$ANCHOR" "select store_id || ' -> ' || schema from openclaw_engine_anchor"; }
anchor_schema() { sqlite3 "$ANCHOR" "select schema from openclaw_engine_anchor"; }
dump_store() { # per-table digest of every Workboard table in schema $1 (openclaw_schema_meta names the namespace, so it is listed separately)
  local s=$1
  for t in $(pgq "SELECT table_name FROM information_schema.tables WHERE table_schema='$s' AND table_type='BASE TABLE' AND table_name LIKE 'workboard_%' ORDER BY 1"); do
    printf '%s %s\n' "$t" "$(psql "$OPENCLAW_PG" -At -c "SELECT coalesce(md5(string_agg(r::text, E'\n' ORDER BY r::text)), '-') || ' rows=' || count(*) FROM \"$s\".\"$t\" r")"
  done
}
cards() { pgq "SELECT title, status, priority FROM \"$1\".workboard_cards ORDER BY title"; }
local_exports() { # every SQLite export image of the Workboard PostgreSQL store on local disk, with bytes
  find "$E/home" "$E/prefix/lib/node_modules" -path "$E/prefix/lib/node_modules/openclaw" -prune -o \
    -path '*workboard.sqlite.postgres/database.sqlite' -type f -print 2>/dev/null | while read -r f; do
    printf '%s bytes  %s\n' "$(stat -f %z "$f")" "$f"
  done | sed -E -e 's#\.openclaw\.package-backup-[0-9]+-[0-9]+\.databases/payload/posix.*#<rollback snapshot>/.../workboard.sqlite.postgres/database.sqlite#' \
               -e 's#\.openclaw\.update-captures/[^/]+/database\.databases/payload/posix.*#.openclaw.update-captures/<run>/database.databases/.../workboard.sqlite.postgres/database.sqlite#'
  echo "(end of list)"
}
{
  echo "\$ openclaw --version"; openclaw --version
  echo "\$ openclaw config set plugins.entries.workboard.enabled true"; openclaw config set plugins.entries.workboard.enabled true 2>&1 | tail -1
  for t in "Card A|high" "Card B|normal" "Card C|low"; do
    echo "\$ openclaw workboard create \"${t%|*}\" --priority ${t#*|}"; openclaw workboard create "${t%|*}" --priority "${t#*|}" 2>&1 | tail -1
  done
  echo '$ openclaw config set database.postgres.connection <dsn>'; openclaw config set database.postgres.connection "$OPENCLAW_PG" 2>&1 | tail -1
  echo '$ openclaw database port --family workboard --to postgres'; openclaw database port --family workboard --to postgres 2>&1 | grep -E '^Database port' | tail -1
  if [ "$mode" = server ]; then
    echo '$ openclaw config set database.postgres.recoveryCaptures server'; openclaw config set database.postgres.recoveryCaptures server 2>&1 | tail -1
  fi
  echo '$ openclaw config get database.postgres.recoveryCaptures'; openclaw config get database.postgres.recoveryCaptures 2>&1 | tail -1
  echo '$ openclaw workboard move <Card A> --status ready'
  a=$(openclaw workboard list 2>/dev/null | awk '/Card A/{print $1}'); openclaw workboard move "$a" --status ready 2>&1 | tail -1
  echo '$ anchor (store id -> live namespace) before'; anchor
  echo '$ psql: capture-related schemas before'; pgcaps
  s0=$(anchor_schema)
  echo "\$ psql: cards in $s0"; cards "$s0"
  echo '$ psql: per-table row digests of the live store before'; dump_store "$s0" | tee $out/rows-before.txt
  echo '$ local SQLite exports of the Workboard store before the update'; local_exports
} 2>&1 | redact > $out/01-setup.txt
touch "$HOME/.openclaw/.proof-fail-update-doctor"   # harness marker, read only by the 2026.11.9 candidate
mark=$(wc -l < "$pglog")
watch=$out/snapshot.watch; : > "$watch"
( while :; do
    find "$E/prefix/lib/node_modules" -maxdepth 1 -name '.openclaw.package-backup-*.databases' -exec find {} -type f \; 2>/dev/null >> "$watch"
    sleep 0.2
  done ) & watcher=$!
{
  echo "\$ openclaw update --tag ./openclaw-2026.11.9.tgz --yes --no-restart --json"
  openclaw update --tag $W/pkg/2026.11.9/openclaw-2026.11.9.tgz --yes --no-restart --json > $out/update.json 2> $out/update.stderr
  echo "UPDATE_RC=$?"
} 2>&1 | redact > $out/02-update.txt
kill $watcher 2>/dev/null; wait $watcher 2>/dev/null
rm -f "$HOME/.openclaw/.proof-fail-update-doctor"
tail -n +"$((mark + 1))" "$pglog" | grep -E '^[0-9-]+ [0-9:.]+ [A-Z]+ \[[0-9]+\] oc_e2e ' > $out/pg-during-update.log
{
  echo '$ update result (--json): status, reason, rollbackOutcome, steps'
  node -e '
    const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));
    const r=j.result??j;
    console.log("status:", r.status, "| reason:", r.reason, "| rollbackOutcome:", JSON.stringify(r.rollbackOutcome??null));
    for (const s of r.steps??[]) {
      const d=[...(s.diagnostics??[]), s.stderrTail??""].filter(Boolean).join(" / ").replace(/\n/g," ");
      console.log("-", s.name, "exit", s.exitCode, d ? "| "+d.slice(0,360) : "");
    }
  ' $out/update.json 2>&1 || head -c 3000 $out/update.json
  echo '$ openclaw --version'; openclaw --version
  echo '$ files of the Workboard rollback capture seen while the update ran'
  sed -E 's#.*/\.openclaw\.package-backup-[0-9]+-[0-9]+\.databases/payload/posix.*/plugins/workboard/#<rollback snapshot>/.../plugins/workboard/#' "$watch" | grep 'workboard.sqlite.postgres/' | sort -u
  echo '$ PostgreSQL log, database oc_e2e, during the update: schema DDL, capture comments, copy statements (truncated)'
  grep -E 'statement: .*(CREATE|DROP|ALTER) SCHEMA|statement: COMMENT ON SCHEMA|statement: INSERT INTO "restore_[^"]*"\."workboard_cards"|statement: INSERT INTO "openclaw_workboard_[^"]*"\."workboard_cards"' $out/pg-during-update.log \
    | grep -v 'port_verify_\|openclaw_check_' \
    | sed -E 's/^([0-9-]+ )([0-9:.]+) [A-Z]+ \[[0-9]+\] oc_e2e LOG:  statement: /\2 /' | cut -c1-170
  echo '(end)'
  echo '$ anchor (store id -> live namespace) after'; anchor
  echo '$ psql: capture-related schemas after'; pgcaps
  s1=$(anchor_schema)
  echo "\$ psql: cards in $s1 (anchor-selected live store)"; cards "$s1"
  echo '$ psql: per-table row digests of the live store after'; dump_store "$s1" > $out/rows-after.txt
  echo '$ diff <before> <after>'; diff $out/rows-before.txt $out/rows-after.txt && echo "(identical: $(wc -l < $out/rows-after.txt | tr -d ' ') Workboard tables)"
  for c in $(pgq "SELECT nspname FROM pg_namespace WHERE nspname LIKE 'restore_%' AND obj_description(oid,'pg_namespace') LIKE '%openclawCapture%' ORDER BY 1"); do
    dump_store "$c" > $out/rows-capture.txt
    echo "\$ diff <before> <retained capture $c>"; diff $out/rows-before.txt $out/rows-capture.txt && echo "(identical)"
  done
  echo '$ rollback capture manifest (retained): carrier fields'
  m=$(find "$E/prefix/lib/node_modules" -path '*.openclaw.package-backup-*databases*' -path '*workboard.sqlite.postgres/manifest.json' 2>/dev/null | head -1)
  [ -n "$m" ] && node -e 'const m=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));const pick=Object.fromEntries(Object.entries(m).filter(([k,v])=>typeof v!=="object"||v===null));console.log(JSON.stringify({carrier:"(none: portable)",...pick}).slice(0,600))' "$m" || echo "(no retained rollback capture manifest)"
  echo '$ retained rollback capture files (Workboard)'
  find "$E/prefix/lib/node_modules" -path '*.openclaw.package-backup-*databases*' -path '*workboard.sqlite.postgres/*' -type f 2>/dev/null | sed -E 's#.*/plugins/workboard/#<rollback snapshot>/.../plugins/workboard/#' | sort
  echo '$ psql: sequences in Workboard namespaces (allocations)'; pgq "SELECT count(*) FROM pg_sequences WHERE schemaname ~ ''^(restore_|openclaw_workboard_)''"
  echo '$ manifest allocation facts'; [ -n "$m" ] && node -e 'const m=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));const f=(o,p)=>{for(const[k,v]of Object.entries(o??{})){if(/alloc|sequence|identity/i.test(k))console.log(p+k+": "+JSON.stringify(v).slice(0,200));else if(v&&typeof v==="object"&&!Array.isArray(v))f(v,p+k+".")}};f(m,"")' "$m"
  echo '$ local SQLite exports of the Workboard store after the update'; local_exports
  echo '$ openclaw workboard list'; openclaw workboard list 2>&1 | tail -4
  echo '$ openclaw workboard create "Card D"   # write after rollback'; openclaw workboard create "Card D" 2>&1 | tail -1
  echo "\$ psql: cards in $(anchor_schema)"; cards "$(anchor_schema)"
} 2>&1 | redact > $out/03-after.txt
cat $out/01-setup.txt $out/02-update.txt $out/03-after.txt
echo E2E_DONE
