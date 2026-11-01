#!/bin/sh
W=$HOME/work/pg-r2-l3d
while ! grep -q FINAL_V4_DONE $W/logs/final-v4-bg.log; do sleep 10; done
cp $W/src-fix/src/config/sessions/session-history-lane-sizing.test.ts $W/src-base/src/config/sessions/ && cp $W/src-fix/src/infra/worker-pool-sizing.test.ts $W/src-base/src/infra/
cd $W/src-base && CI=1 node scripts/run-vitest.mjs src/infra/worker-pool-sizing.test.ts src/config/sessions/session-history-lane-sizing.test.ts > $W/logs/unit-red.log 2>&1; echo "UNIT_DONE red rc=$? $(date)" >> $W/logs/unit-red.log
rm -f $W/src-base/src/config/sessions/session-history-lane-sizing.test.ts $W/src-base/src/infra/worker-pool-sizing.test.ts
echo RED_V4_DONE
