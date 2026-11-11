#!/bin/bash
# Placeholders: SCRIPTS (this directory), WORK (scratch work dir on local disk), BUNDLES (dir with the git bundle of the PR
# head), PNPM_STORE / NPM_CACHE (local caches), BREW_BIN (PostgreSQL 17 binaries), PR_HEAD_REPO (the PR head repository URL).
# Usage: r2-upgrade.sh <label> <pr|base>
# Real upgrade from the latest stable npm release (openclaw@2026.11.3, registry) to a packed build (2026.11.8):
# pr = head 9edd6cbabc1, base = main 577da8a944e (control). Stable gets settings, an extra agent, Workboard cards
# ported to PostgreSQL, a verified portable backup archive and a standalone doctor --fix original state capture.
set -uo pipefail
S=$SCRIPTS
source $S/env.sh
# Physical paths: ~/work is a symlink to the SSD, and OpenClaw refuses capture roots reached through an alias.
W=$(cd "$W" && pwd -P); E=$W/e2e; export HOME=$E/home NPM_CONFIG_PREFIX=$E/prefix NPM_CONFIG_CACHE=$E/npm-cache TMPDIR=$E/tmp PATH=$E/prefix/bin:$PATH
label=$1 pkg=$2
out=$W/out/$label
rm -rf "$E" "$out" && mkdir -p "$E/home" "$E/prefix" "$E/tmp" "$E/backups" "$out"
psql -h 127.0.0.1 -p $PGPORT -U postgres -qc "DROP DATABASE IF EXISTS oc_e2e WITH (FORCE)" -c "CREATE DATABASE oc_e2e"
psql -h 127.0.0.1 -p $PGPORT -U postgres -d oc_e2e -qc 'CREATE EXTENSION unaccent WITH SCHEMA public; CREATE EXTENSION pg_trgm WITH SCHEMA public; CREATE EXTENSION vector WITH SCHEMA public;'
pglog=$W/pg/log
ANCHOR=$HOME/.openclaw/plugins/workboard/workboard.sqlite
anchor_of() { sqlite3 "$1" "select store_id || ' -> ' || schema from openclaw_engine_anchor"; }
schema_of() { sqlite3 "$1" "select schema from openclaw_engine_anchor"; }
save_cols() { # table|cols for every Workboard table in schema $1, column order as at stable
  pgq "SELECT table_name || '|' || string_agg(quote_ident(column_name), ',' ORDER BY ordinal_position) FROM information_schema.columns WHERE table_schema='$1' AND table_name LIKE 'workboard_%' AND table_name IN (SELECT table_name FROM information_schema.tables WHERE table_schema='$1' AND table_type='BASE TABLE') GROUP BY table_name ORDER BY 1" > $out/stable-columns.txt
}
dump_store() { # per-table digest over the stable columns in schema $1
  while IFS='|' read -r t cols; do
    printf '%s %s\n' "$t" "$(psql "$OPENCLAW_PG" -At -c "SELECT coalesce(md5(string_agg(x, E'\n' ORDER BY x)), '-') || ' rows=' || count(*) FROM (SELECT ROW($cols)::text AS x FROM \"$1\".\"$t\") r" 2>&1 | head -1)"
  done < $out/stable-columns.txt
}
cards() { pgq "SELECT title, status, priority FROM \"$1\".workboard_cards ORDER BY title"; }
caps_files() { # files of standalone/update original state captures with sha256
  find "$HOME/.openclaw.update-captures" -type f 2>/dev/null | sort | while read -r f; do printf '%s  %s\n' "$(shasum -a 256 "$f" | cut -c1-64)" "${f#$HOME/.openclaw.update-captures/}"; done
}
{
  echo '$ npm install -g openclaw@2026.11.3   # latest on the npm registry'; npm install -g openclaw@2026.11.3 --allow-scripts=openclaw > $out/npm-stable.log 2>&1; echo "rc=$?"
  echo '$ openclaw --version'; openclaw --version
  echo '$ openclaw doctor --fix --non-interactive   # first run'; openclaw doctor --fix --non-interactive > $out/doctor-stable-1.log 2>&1; echo "DOCTOR_RC=$?"
  echo '$ openclaw config set agents.defaults.timeoutSeconds 321'; openclaw config set agents.defaults.timeoutSeconds 321 2>&1 | tail -1
  echo '$ openclaw config set plugins.entries.workboard.enabled true'; openclaw config set plugins.entries.workboard.enabled true 2>&1 | tail -1
  echo '$ openclaw agents add helper --non-interactive --workspace <e2e>/home/helper-ws'; openclaw agents add helper --non-interactive --workspace "$HOME/helper-ws" > $out/agents-add.log 2>&1; echo "rc=$?"
  for t in "Card A|high" "Card B|normal" "Card C|low"; do
    echo "\$ openclaw workboard create \"${t%|*}\" --priority ${t#*|}"; openclaw workboard create "${t%|*}" --priority "${t#*|}" 2>&1 | tail -1
  done
  echo '$ openclaw workboard move <Card A> --status ready'; a=$(openclaw workboard list 2>/dev/null | awk '/Card A/{print $1}'); openclaw workboard move "$a" --status ready 2>&1 | tail -1
  echo '$ openclaw config set database.postgres.connection <dsn>'; openclaw config set database.postgres.connection "$OPENCLAW_PG" 2>&1 | tail -1
  echo '$ openclaw database port --to postgres'; openclaw database port --to postgres > $out/port.log 2>&1; echo "rc=$?"; grep -E '^Database port|ported|Ported' $out/port.log | tail -2
  echo '$ openclaw workboard list'; openclaw workboard list 2>&1 | tail -4
  echo '$ anchor (store id -> live namespace)'; anchor_of "$ANCHOR"
  s0=$(schema_of "$ANCHOR"); save_cols "$s0"
  echo "\$ psql: cards in $s0"; cards "$s0"
  echo '$ psql: per-table row digests (stable columns)'; dump_store "$s0" | tee $out/rows-stable.txt
  echo '$ openclaw backup create --output <e2e>/backups --verify'; openclaw backup create --output "$E/backups" --verify > $out/backup-create.log 2>&1; echo "rc=$?"
  arch=$(ls "$E"/backups/*.tar.gz 2>/dev/null | head -1); echo "archive: $(basename "$arch") sha256 $(shasum -a 256 "$arch" | cut -c1-64)"
  echo '$ openclaw doctor --fix --non-interactive   # standalone original state capture'; openclaw doctor --fix --non-interactive > $out/doctor-stable-2.log 2>&1; echo "DOCTOR_RC=$?"
  echo '$ files of original state captures (sha256)'; caps_files | tee $out/captures-stable.txt | grep -E 'workboard|manifest' | head -12
  echo '$ psql: schemas'; pgcaps
} 2>&1 | redact > $out/01-stable.txt
arch=$(ls "$E"/backups/*.tar.gz 2>/dev/null | head -1)
mark=$(wc -l < "$pglog")
watch=$out/snapshot.watch; : > "$watch"
( while :; do find "$E/prefix/lib/node_modules" -maxdepth 1 -name '.openclaw.package-backup-*.databases' -exec find {} -type f \; 2>/dev/null >> "$watch"; sleep 0.2; done ) & watcher=$!
{
  echo "\$ openclaw update --tag ./openclaw-2026.11.8.tgz --yes --no-restart --json   # $pkg build"
  openclaw update --tag $W/pkg/$pkg/openclaw-2026.11.8.tgz --yes --no-restart --json > $out/update.json 2> $out/update.stderr
  echo "UPDATE_RC=$?"
} 2>&1 | redact > $out/02-update.txt
kill $watcher 2>/dev/null; wait $watcher 2>/dev/null
tail -n +"$((mark + 1))" "$pglog" | grep -E ' oc_e2e ' > $out/pg-during-update.log
{
  echo '$ update result (--json)'
  node -e '
    const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")); const r=j.result??j;
    console.log("status:", r.status, "| reason:", r.reason ?? "-", "| before:", r.before?.version ?? "-", "| after:", r.after?.version ?? "-");
    for (const s of r.steps??[]) { const d=[...(s.diagnostics??[]), s.stderrTail??""].filter(Boolean).join(" / ").replace(/\n/g," "); console.log("-", s.name, "exit", s.exitCode, d ? "| "+d.slice(0,300) : ""); }
  ' $out/update.json 2>&1 | head -40 || head -c 3000 $out/update.json
  echo '$ files of the Workboard rollback capture seen while the update ran'
  sed -E 's#.*/\.openclaw\.package-backup-[0-9]+-[0-9]+\.databases/payload/posix.*/plugins/workboard/#<rollback snapshot>/.../plugins/workboard/#' "$watch" | grep 'workboard.sqlite.postgres/' | sort -u
  echo '$ PostgreSQL log during the update: restore_ schema DDL'; grep -cE 'statement: .*(CREATE|DROP) SCHEMA[^;]*restore_' $out/pg-during-update.log
} 2>&1 | redact >> $out/02-update.txt
{
  echo '$ openclaw --version'; openclaw --version
  echo '$ openclaw config get agents.defaults.timeoutSeconds'; openclaw config get agents.defaults.timeoutSeconds 2>&1 | tail -1
  echo '$ openclaw config get plugins.entries.workboard.enabled'; openclaw config get plugins.entries.workboard.enabled 2>&1 | tail -1
  echo '$ openclaw config get database.postgres.connection'; openclaw config get database.postgres.connection 2>&1 | tail -1
  echo '$ openclaw agents list --json (ids)'; openclaw agents list --json 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);console.log((j.agents??j).map(a=>a.id).join(", "))})'
  echo '$ anchor (store id -> live namespace)'; anchor_of "$ANCHOR"
  s1=$(schema_of "$ANCHOR")
  echo "\$ psql: cards in $s1"; cards "$s1"
  echo '$ diff <stable rows> <rows after upgrade>   # per table, stable columns'; dump_store "$s1" > $out/rows-after.txt; diff $out/rows-stable.txt $out/rows-after.txt && echo "(identical: $(wc -l < $out/rows-after.txt | tr -d ' ') Workboard tables)"
  echo '$ openclaw workboard list'; openclaw workboard list 2>&1 | tail -4
  echo '$ openclaw workboard create "Card D"   # write after upgrade'; openclaw workboard create "Card D" 2>&1 | tail -1
  echo '$ openclaw doctor --non-interactive'; openclaw doctor --non-interactive > $out/doctor-after.log 2>&1; echo "DOCTOR_RC=$?"
  echo '$ stable original state capture files: sha256 before vs after upgrade'
  caps_files > $out/captures-after.txt
  comm -23 <(sort $out/captures-stable.txt) <(sort $out/captures-after.txt) | sed 's/^/missing or changed: /'; echo "(stable files: $(wc -l < $out/captures-stable.txt | tr -d ' '), unchanged: $(comm -12 <(sort $out/captures-stable.txt) <(sort $out/captures-after.txt) | wc -l | tr -d ' '))"
  echo '$ openclaw update status   # capture inventory'; openclaw update status > $out/update-status.log 2>&1; echo "rc=$?"; grep -iE 'capture|retain' $out/update-status.log | head -6
  echo '$ openclaw config set database.postgres.recoveryCaptures server'; openclaw config set database.postgres.recoveryCaptures server 2>&1 | tail -1
  echo '$ openclaw backup verify <stable archive>   # written by 2026.11.3'; openclaw backup verify "$arch" > $out/verify.log 2>&1; echo "rc=$?"; tail -1 $out/verify.log
  echo '$ openclaw backup restore <stable archive> --target <e2e>/restored'; openclaw backup restore "$arch" --target "$E/restored" > $out/restore.log 2>&1; echo "rc=$?"; tail -2 $out/restore.log
  ra=$(find "$E/restored" -path '*plugins/workboard/workboard.sqlite' -type f 2>/dev/null | head -1)
  echo '$ restored anchor (store id -> namespace)'; [ -n "$ra" ] && anchor_of "$ra"
  if [ -n "$ra" ]; then r=$(schema_of "$ra"); echo "\$ diff <stable rows> <restored $r>"; dump_store "$r" > $out/rows-restored.txt; diff $out/rows-stable.txt $out/rows-restored.txt && echo "(identical)"; fi
  echo '$ live anchor after restore (unchanged)'; anchor_of "$ANCHOR"
  echo '$ psql: schemas'; pgcaps
} 2>&1 | redact > $out/03-after.txt
cat $out/01-stable.txt $out/02-update.txt $out/03-after.txt
echo R2_DONE
