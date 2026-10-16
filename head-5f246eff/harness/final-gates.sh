cd ~/work/pr164796
L=~/work/pr164796-logs
sh $L/targeted.sh > $L/f-targeted.log 2>&1
export OPENCLAW_VITEST_MAX_WORKERS=8
for d in src/agents/cli-runner/ extensions/anthropic/ src/plugin-sdk/provider-auth-claude-compat.test.ts; do
  n=$(echo $d | tr '/.' '__')
  node --import ./scripts/tsx.mjs scripts/test-projects.mts $d > $L/f-lane-$n.log 2>&1
  echo "EXIT $? $d" >> $L/f-lanes.log
done
pnpm check:changed > $L/f-check-changed.log 2>&1
echo "EXIT $?" >> $L/f-check-changed.log
echo ALLDONE >> $L/f-lanes.log
