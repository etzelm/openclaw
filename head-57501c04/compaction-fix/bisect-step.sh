#!/bin/bash
# git bisect run step: build dist + run the e2e test once. 125 = skip on build failure.
cd ~/work/pr-164796-cr || exit 125
export PATH=$HOME/homebrew/bin:$PATH OPENCLAW_VITEST_RUNTIME=node OPENCLAW_E2E_USE_PREBUILT_DIST=1
O=~/work/pr-164796-cr-out/bisect; mkdir -p $O; h=$(git rev-parse --short=11 HEAD)
pnpm install --frozen-lockfile > $O/$h-install.log 2>&1 || exit 125
pnpm build > $O/$h-build.log 2>&1 || { rm -rf .artifacts/dist-artifacts.lock; exit 125; }
node --import tsx scripts/tsdown-build.mts --config tsdown.ai.config.ts > $O/$h-ai.log 2>&1 || exit 125
node_modules/.bin/vitest run --config test/vitest/vitest.e2e.config.ts test/gateway-openai-compaction-replay.e2e.test.ts > $O/$h-test.log 2>&1
rc=$?
L=$(sed 's/\x1b\[[0-9;]*m//g' $O/$h-test.log | grep -E 'AssertionError|Tests  ' | head -2 | tr '\n' ' ')
echo "$h rc=$rc $L" >> ~/work/pr-164796-cr-out/bisect-steps.txt
# only the target assertion counts as bad; other failures skip
if [ $rc = 0 ]; then exit 0; fi
grep -q 'to have a length of 2 but got 3' $O/$h-test.log && exit 1
exit 125
