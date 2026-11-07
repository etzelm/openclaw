#!/bin/sh
# Green conformance on the PR head, then interleaved Gateway traces (base, fix, base, fix).
W=$HOME/work/pc-190001; cd $W || exit 1
sh scripts/conf.sh fix green src/config/sessions/session-history-read-snapshot.postgres.test.ts \
  src/config/sessions/session-accessor.sqlite-read-hold.postgres.test.ts src/infra/postgres-sync src/state/openclaw-agent-db.postgres.test.ts \
  src/state/openclaw-agent-db-engine.postgres.test.ts src/state/openclaw-state-db.postgres.test.ts
tail -1 logs/conformance-green.log
for r in 1 2; do for a in base fix; do python3 -I scripts/run.py trace $a $a-r$r; done; done
echo CHAIN_DONE
