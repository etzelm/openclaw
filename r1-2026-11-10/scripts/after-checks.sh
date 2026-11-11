#!/bin/bash
# Placeholders: SCRIPTS (this directory), WORK (scratch work dir on local disk), BUNDLES (dir with the git bundle of the PR
# head), PNPM_STORE / NPM_CACHE (local caches), BREW_BIN (PostgreSQL 17 binaries), PR_HEAD_REPO (the PR head repository URL).
# Follow-up checks on the server-mode install left by rollback-e2e.sh server.
set -uo pipefail
source $SCRIPTS/env.sh
out=$W/out/server
exports() {
  find "$E/home" "$E/prefix/lib/node_modules" -path "$E/prefix/lib/node_modules/openclaw" -prune -o \
    -path '*workboard.sqlite.postgres/database.sqlite' -type f -print 2>/dev/null | while read -r f; do
    printf '%s bytes  %s\n' "$(stat -f %z "$f")" "$f"
  done | sed -E -e 's#\.openclaw\.update-captures/[^/]+/([^/]+)/payload/posix.*#.openclaw.update-captures/<id>/\1/.../workboard.sqlite.postgres/database.sqlite#' \
                 -e 's#\.openclaw\.package-backup-[0-9]+-[0-9]+\.databases/payload/posix.*#<rollback snapshot>/.../workboard.sqlite.postgres/database.sqlite#'
  echo "(end of list)"
}
{
  echo '$ psql: sequences in Workboard namespaces'
  psql "$OPENCLAW_PG" -At -c "SELECT count(*) FROM pg_sequences WHERE schemaname ~ '^(restore_|openclaw_workboard_)'"
  echo '$ psql: identity or serial columns in the live Workboard namespace'
  s=$(sqlite3 "$HOME/.openclaw/plugins/workboard/workboard.sqlite" "select schema from openclaw_engine_anchor")
  psql "$OPENCLAW_PG" -At -c "SELECT count(*) FROM information_schema.columns WHERE table_schema='$s' AND (is_identity='YES' OR column_default LIKE 'nextval%')"
  echo '$ local SQLite exports of the Workboard store before standalone Doctor'; exports
  echo '$ openclaw doctor --fix --non-interactive'
  openclaw doctor --fix --non-interactive > $out/doctor-fix.log 2>&1; echo "DOCTOR_RC=$?"
  echo '$ local SQLite exports of the Workboard store after standalone Doctor'; exports
  echo '$ psql: capture-related schemas after standalone Doctor'; pgcaps
} 2>&1 | redact > $out/04-doctor-and-allocations.txt
cat $out/04-doctor-and-allocations.txt
