#!/bin/bash
# Round-2b gates at the merge of main 372095136ef into d688a94fc48 (tree under test = merge tip).
cd ~/work/pr-164796-merge3 || exit 1
export PATH=$HOME/homebrew/bin:$PATH OPENCLAW_VITEST_MAX_WORKERS=4
BASE=372095136effb8dcaf2d9e59ace8bae193a6573b
D=$TOOLS
G=~/work/pr-164796-merge3-gates; S=$G/summary.txt; : > $S
strip() { sed 's/\x1b\[[0-9;]*m//g'; }
ident() { echo "HEAD $(git rev-parse HEAD) TREE $(git rev-parse HEAD^{tree}) dirty=$(git status --porcelain | wc -l | tr -d ' ')"; }
load() { uptime | sed 's/.*averages: //'; }
ident | tee $G/identity.txt >> $S
echo "merged main $BASE; parents $(git log -1 --format=%P)" >> $G/identity.txt
echo "start $(date) load $(load)" >> $S
CH=$(git diff --name-only --diff-filter=AM $BASE HEAD)
TS=$(echo "$CH" | grep -E '\.ts$' | tr '\n' ' '); SRC=$(echo "$CH" | grep -E '^src/.*\.ts$' | tr '\n' ' ')
pnpm exec oxfmt --check $(echo "$CH" | grep -E '\.(ts|tsx|js|mjs|json|md)$') > $G/oxfmt-check.log 2>&1; echo "oxfmt --check (changed files) EXIT $?" >> $S
node scripts/run-oxlint.mjs $TS > $G/oxlint.log 2>&1; echo "oxlint (changed .ts, default config) EXIT $?" >> $S
node scripts/run-oxlint.mjs --tsconfig config/tsconfig/oxlint.core.json $SRC > $G/oxlint-core.log 2>&1; echo "oxlint core config (changed src .ts) EXIT $?" >> $S
git diff --check $BASE HEAD > $G/diff-check.log 2>&1; echo "git diff --check $BASE HEAD EXIT $?" >> $S
for t in tsgo:core tsgo:core:test tsgo:extensions tsgo:extensions:test; do n=$(echo $t | tr ':' '-'); pnpm $t > $G/f-$n.log 2>&1; echo "pnpm $t EXIT $?" >> $S; done
P=src/agents/cli-runner/prepare-native-history.test.ts
A=src/agents/cli-runner/cli-run-transcript.admission.test.ts
CHANGED=$(echo "$CH" | grep -E '\.test\.ts$' | tr '\n' ' ')
pnpm test $CHANGED > $G/targeted-all-changed-tests.log 2>&1; rc=$?; echo "targeted: every changed test file ($(echo $CHANGED | wc -w | tr -d ' ') files: $CHANGED) EXIT $rc" >> $S
strip < $G/targeted-all-changed-tests.log | grep -E "^ FAIL |Test Files|Tests  |\[test\] (passed|failed)" >> $S
R15=$(for f in $(cat $OUT/../r15-targeted-files.txt); do [ -f "$f" ] && echo $f; done | tr '\n' ' ')
pnpm test $R15 > $G/targeted-r15-set.log 2>&1; rc=$?; echo "targeted: r15 set, files still present ($(echo $R15 | wc -w | tr -d ' ') files) EXIT $rc" >> $S
strip < $G/targeted-r15-set.log | grep -E "^ FAIL |Test Files|Tests  |\[test\] (passed|failed)" >> $S
pnpm test src/plugin-sdk/provider-auth.test.ts extensions/openai/realtime-voice-browser-auth.test.ts > $G/shipped-keychain-reader-consumers.log 2>&1; echo "shipped readClaudeCliCredentials consumers EXIT $?" >> $S
strip < $G/shipped-keychain-reader-consumers.log | grep -E "^ FAIL |Test Files|Tests  " >> $S
for i in 1 2 3; do
  OPENCLAW_VITEST_MAX_WORKERS=1 pnpm test $P $A > $G/pair-prepare-admission-$i.log 2>&1; echo "pair prepare-native-history + admission, 1 worker, run $i EXIT $?" >> $S
  strip < $G/pair-prepare-admission-$i.log | grep -E "^ FAIL |Test Files|Tests  " >> $S
done
bash $D/redgreen.sh > $G/redgreen.log 2>&1; echo "redgreen RED1-RED5,RED7-RED12 EXIT $? $(ident)" >> $S
grep -E "^## |^ FAIL |Tests  |DID NOT APPLY|DIRTY|AssertionError: \(" $G/redgreen.log >> $S
pnpm build > $G/build.log 2>&1; rc=$?; echo "pnpm build EXIT $rc" >> $S
strip < $G/build.log | grep "phase timings" >> $S
if [ $rc -eq 0 ]; then
  bash $D/run-after.sh > $G/harness-run.out 2>&1; echo "harness run-after EXIT $?" >> $S
  bash $D/run-upgrade.sh > $G/harness-upgrade.out 2>&1; echo "harness run-upgrade (2026.10.4) EXIT $?" >> $S
  cp ~/work/pr-164796-h/logs/outcomes-after.txt $G/outcomes-after.txt
  bash $D/run-upgrade-1005.sh > $G/harness-upgrade-1005.out 2>&1; echo "harness run-upgrade-1005 EXIT $?" >> $S
  echo "upgrade 2026.10.5 row: $(cat ~/work/pr-164796-h/logs/outcomes-upgrade-1005.txt)" >> $S
  diff ~/work/pr-164796-h/ref/outcomes-after.round2-148b78f9.txt $G/outcomes-after.txt > $G/harness-outcomes-vs-round2.diff 2>&1; echo "harness outcomes raw diff vs round2 148b78f9f4a EXIT $? ($(wc -l < $G/harness-outcomes-vs-round2.diff | tr -d ' ') lines)" >> $S
  bash $D/mask-compare.sh > $G/harness-compare.txt 2>&1; cat $G/harness-compare.txt >> $S
fi
echo "lanes start load $(load)" >> $S
for lane in src/agents/cli-runner/ extensions/anthropic/ src/plugin-sdk/provider-auth-claude-compat.test.ts src/agents/sessions/ src/config/sessions/; do
  n=$(echo $lane | tr '/.' '__')
  pnpm test $lane > $G/lane-$n.log 2>&1; rc=$?; echo "lane $lane EXIT $rc (load after $(load))" >> $S
  strip < $G/lane-$n.log | grep -E "^ FAIL |Test Files|Tests  |\[test\] (starting|passed|failed)" | sort -u | head -40 >> $S
done
pnpm check:changed --base $BASE > $G/check-changed.log 2>&1; echo "check:changed --base $BASE EXIT $?" >> $S
strip < $G/check-changed.log | grep -E "^ *[0-9.]+m?s +failed" >> $S
echo "check:changed ok steps: $(strip < $G/check-changed.log | grep -cE '^ *[0-9.]+m?s +ok ')" >> $S
node --import ./scripts/tsx.mjs scripts/check-env-var-count.mts > $G/f-check-env-var-count.log 2>&1; echo "check-env-var-count EXIT $?" >> $S
strip < $G/f-check-env-var-count.log | tail -1 >> $S
echo "end: $(ident) $(date)" >> $S
echo "ALL DONE" >> $S
touch $G/gates.done
