#!/bin/bash
# usage: run-arm.sh <name> [nobuild]  (runs in current checkout state)
cd ~/work/pr-164796-cr || exit 1
export PATH=$HOME/homebrew/bin:$PATH OPENCLAW_VITEST_RUNTIME=node OPENCLAW_E2E_USE_PREBUILT_DIST=1
O=~/work/pr-164796-cr-out; name=$1
S=$O/$name-summary.txt; : > $S
echo "$name $(git rev-parse HEAD) dirty=$(git status --porcelain | grep -v '^??' | wc -l) $(date)" >> $S
if [ "$2" != nobuild ]; then
  pnpm install --frozen-lockfile > $O/$name-install.log 2>&1; echo "install rc=$?" >> $S
  pnpm build > $O/$name-build.log 2>&1; rc=$?; echo "build rc=$rc" >> $S; [ $rc = 0 ] || { echo DONE >> $S; exit 1; }
  node --import tsx scripts/tsdown-build.mts --config tsdown.ai.config.ts > $O/$name-build-ai.log 2>&1; echo "build-ai rc=$?" >> $S
fi
for i in 1 2 3; do
  node_modules/.bin/vitest run --config test/vitest/vitest.e2e.config.ts test/gateway-openai-compaction-replay.e2e.test.ts > $O/$name-$i.log 2>&1
  rc=$?
  echo "run $i rc=$rc $(sed 's/\x1b\[[0-9;]*m//g' $O/$name-$i.log | grep -E 'Tests  |AssertionError' | head -2 | tr '\n' ' ')" >> $S
done
echo DONE >> $S
