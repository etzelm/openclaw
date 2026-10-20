#!/bin/bash
# merge5 sequence: gates (+ CI tests 3x) -> red/green -> harness -> pristine main compaction e2e 3x.
export PATH=$HOME/homebrew/bin:$PATH
W=~/work/pr-164796-m5; D=$W/.m5; L=$D/driver.txt
cd $W || exit 1
echo "driver start $(date)" > $L
bash $D/gates.sh; echo "gates exit=$? $(date +%T)" >> $L
grep -q "^build exit=0" $D/gates/summary.txt || { echo "build failed, stop" >> $L; echo done > $D/driver.done; exit 1; }
bash $D/redgreen.sh > $D/gates/redgreen.log 2>&1; echo "redgreen exit=$? $(date +%T)" >> $L
[ -z "$(git -C $W status --porcelain)" ] || { echo "DIRTY after redgreen, stop" >> $L; echo done > $D/driver.done; exit 1; }
# Harness: same path length as m4-harness.
rm -rf ~/work/m5-harness; mkdir -p ~/work/m5-harness
(cd ~/work/pr-164796-h/harness && tar -cf - --exclude ./runs .) | (cd ~/work/m5-harness && tar -xf -)
cp $D/harness-scripts/drv-*.sh ~/work/m5-harness/ && chmod +x ~/work/m5-harness/drv-*.sh
bash ~/work/m5-harness/drv-all.sh > ~/work/m5-harness/drv-all.log 2>&1; echo "harness exit=$? $(date +%T) $(tr '\n' ' ' < ~/work/m5-harness/out/drv.txt)" >> $L
# Pristine main at the merged SHA: own worktree and install, build + ai build, compaction e2e 3x.
MAIN=051bf6fa4d05e0870d0f360aee7ac1643cbb787d; P=$D/pristine; PG=$D/gates/pristine; mkdir -p $PG
git -C $W worktree add -q --detach $P $MAIN > $PG/worktree.log 2>&1; echo "pristine worktree exit=$? head=$(git -C $P rev-parse HEAD)" >> $L
cd $P || exit 1
pnpm install --frozen-lockfile > $PG/install.log 2>&1; echo "pristine install exit=$?" >> $L
pnpm build > $PG/build.log 2>&1; echo "pristine build exit=$? $(date +%T)" >> $L
node --import tsx scripts/tsdown-build.mts --config tsdown.ai.config.ts > $PG/build-ai.log 2>&1; echo "pristine build-ai exit=$?" >> $L
export OPENCLAW_VITEST_RUNTIME=node OPENCLAW_E2E_USE_PREBUILT_DIST=1
for i in 1 2 3; do
  node_modules/.bin/vitest run --config test/vitest/vitest.e2e.config.ts test/gateway-openai-compaction-replay.e2e.test.ts > $PG/e2e-compaction-$i.log 2>&1; rc=$?
  echo "pristine e2e-compaction run $i exit=$rc $(sed 's/\x1b\[[0-9;]*m//g' $PG/e2e-compaction-$i.log | grep -E 'AssertionError|Tests  ' | head -2 | tr '\n' ' ')" >> $L
done
echo "driver end $(date)" >> $L
echo done > $D/driver.done
