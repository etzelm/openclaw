#!/bin/sh
W=$HOME/work/pg-r2-l3c
T="src/infra/postgres-sync/read-facts.postgres.test.ts src/infra/postgres-sync/reuse.postgres.test.ts src/infra/postgres-sync/session-publication.postgres.test.ts src/infra/postgres-sync/transcript-hydration.postgres.test.ts src/infra/postgres-sync/commit-receipts.postgres.test.ts src/config/sessions/session-accessor.sqlite-read-hold.postgres.test.ts src/infra/database-engine/state-read-admission.postgres.test.ts src/state/openclaw-agent-db.postgres.test.ts src/config/sessions/session-turn-resident.postgres.test.ts src/infra/database-engine/state-read-lock.postgres.test.ts src/infra/database-engine/agent-port.postgres.test.ts"
sh $W/scripts/conformance.sh fix conformance-fix $T src/config/sessions/session-history-read-snapshot.postgres.test.ts
sh $W/scripts/conformance.sh base conformance-base $T
echo CONF_BOTH_DONE
