#!/bin/sh
# v4 (history lane pool moved to the pools module): format, check:changed, unit tests, rebuild, one confirmation run.
export LC_ALL=en_US.UTF-8 LANG=en_US.UTF-8 CI=1 npm_config_update_notifier=false
W=$HOME/work/pg-r2-l3d; cd $W/src-fix || exit 1
while ! grep -q IDLE_DONE $W/logs/idle-bg.log; do sleep 15; done
git checkout -q -- . && rm -f src/infra/worker-pool-sizing.test.ts src/config/sessions/session-history-lane-sizing.test.ts && git apply ~/nas/outputs/pg-round2/L3d/patch/fix-v4.diff && echo "v4 applied"
pnpm exec oxfmt --write src/infra/worker-pool-sizing.ts src/infra/worker-pool-sizing.test.ts src/config/sessions/session-transcript-read-pools.ts src/config/sessions/session-transcript-worker-resources.ts src/config/sessions/session-history-lane-sizing.test.ts docs/agent-runtime-architecture.md docs/gateway/postgresql.md > $W/logs/format-v4.log 2>&1; echo "FORMAT rc=$?" >> $W/logs/format-v4.log
git add -N . && git diff > $W/logs/fix-v4-formatted.diff
pnpm check:changed --base 31866655fd6 > $W/logs/check-changed.log 2>&1; echo "CHECK_CHANGED rc=$? $(date)" >> $W/logs/check-changed.log
node scripts/run-vitest.mjs src/infra/worker-pool-sizing.test.ts src/config/sessions/session-history-lane-sizing.test.ts src/config/sessions/session-transcript-worker-lanes.test.ts src/config/sessions/session-transcript-search.worker.test.ts src/config/sessions/session-transcript-reconcile.readiness.test.ts src/config/sessions/session-history-worker-errors.test.ts src/gateway/server-methods/chat-history-worker.test.ts src/infra/worker-task-pool.preparation.test.ts src/config/sessions/session-transcript-anchor-read.worker.test.ts src/config/sessions/session-transcript-context-read.worker.test.ts src/infra/git-content-budget.test.ts src/state/openclaw-agent-execution.close-wedge.test.ts > $W/logs/unit-final.log 2>&1; echo "UNIT_DONE final rc=$? $(date)" >> $W/logs/unit-final.log
pnpm build > $W/logs/build-fix-v4.log 2>&1; echo "build rc=$? $(date)"
cd $W && sh scripts/instrument.sh fix
python3 -I scripts/runL3d.py fix postgres seed_pgc results/pg-fixv4-r7 20 h1:ops_seed_pgc.json:45:1 h8:ops_seed_pgc.json:45:8 h16:ops_seed_pgc.json:45:16 >> logs/rounds-v4.log 2>&1
python3 -c "import json;p='results/pg-fixv4-r7/run.json';r=json.load(open(p));r['src']='fix-v4';json.dump(r,open(p,'w'),indent=1)"
echo "FINAL_V4_DONE $(date)"
