#!/bin/bash
# Gates at the merged head (branch fae9f7abf89 + origin/main ee2c67141c1).
cd ~/work/merge-164796 || exit 1
export PATH=$HOME/homebrew/bin:$PATH
export OPENCLAW_VITEST_MAX_WORKERS=4
BASE=ee2c67141c142860b341eeed7d94e80427a922e4
G=~/work/merge-164796-gates; S=$G/summary.txt; : > $S
strip() { sed 's/\x1b\[[0-9;]*m//g'; }
ident() { echo "HEAD $(git rev-parse HEAD) TREE $(git rev-parse HEAD^{tree}) dirty=$(git status --porcelain | wc -l | tr -d ' ')"; }
ident | tee $G/identity.txt >> $S
echo "merged main $BASE; parents $(git log -1 --format=%P)" >> $G/identity.txt
P=src/agents/cli-runner/prepare-native-history.test.ts
A=src/agents/cli-runner/cli-run-transcript.admission.test.ts
CHANGED=$(git diff --name-only --diff-filter=AM $BASE HEAD | grep -E '\.test\.ts$' | tr '\n' ' ')
pnpm test $CHANGED > $G/targeted-all-changed-tests.log 2>&1; echo "targeted: every changed test file vs merged main ($(echo $CHANGED | wc -w | tr -d ' ') files: $CHANGED) EXIT $?" >> $S
strip < $G/targeted-all-changed-tests.log | grep -E "^ FAIL |Test Files|Tests  |\[test\] (passed|failed)" >> $S
R15=$(for f in $(cat $HOME/nas/outputs/pr-simplify/164796/r15-targeted-files.txt); do [ -f "$f" ] && echo $f; done | tr '\n' ' ')
pnpm test $R15 > $G/targeted-r15-set.log 2>&1; echo "targeted: r15 set, files still present ($(echo $R15 | wc -w | tr -d ' ') files) EXIT $?" >> $S
strip < $G/targeted-r15-set.log | grep -E "^ FAIL |Test Files|Tests  |\[test\] (passed|failed)" >> $S
pnpm test src/plugin-sdk/provider-auth.test.ts extensions/openai/realtime-voice-browser-auth.test.ts > $G/shipped-keychain-reader-consumers.log 2>&1; echo "shipped readClaudeCliCredentials consumers EXIT $?" >> $S
strip < $G/shipped-keychain-reader-consumers.log | grep -E "^ FAIL |Test Files|Tests  " >> $S
cp $P $G/prepare.bak
python3 -I - $P <<'PY'
import sys
p=sys.argv[1]; s=open(p).read()
a='import { patchSessionEntryCore } from "../../config/sessions/session-accessor.js";\n'
b='    await fixture.settle();\n'
assert s.count(a)==1 and s.count(b)==1
s=s.replace(a,a+'import { assertNoRetainedSessionSharingReads } from "../../config/sessions/session-accessor.sqlite-diagnostics.test-support.js";\n')
s=s.replace(b,b+'    assertNoRetainedSessionSharingReads();\n')
open(p,"w").write(s)
PY
pnpm test $P > $G/leak-check.log 2>&1; echo "leak check (temporary afterEach assertion in $P) EXIT $?" >> $S
strip < $G/leak-check.log | grep -E "^ FAIL |Test Files|Tests  " >> $S
cp $G/prepare.bak $P; rm $G/prepare.bak; echo "restored: $(ident)" >> $S
for i in 1 2 3; do
  OPENCLAW_VITEST_MAX_WORKERS=1 pnpm test $P $A > $G/pair-prepare-admission-$i.log 2>&1; echo "pair prepare-native-history + admission, 1 worker, run $i EXIT $?" >> $S
  strip < $G/pair-prepare-admission-$i.log | grep -E "^ FAIL |Test Files|Tests  " >> $S
done
bash $G/redgreen.sh > $G/redgreen.log 2>&1; echo "redgreen RED1-RED10 EXIT $? $(ident)" >> $S
grep -E "^## |^ FAIL |Tests  |DID NOT APPLY|DIRTY" $G/redgreen.log >> $S
for t in tsgo:core tsgo:core:test tsgo:extensions tsgo:extensions:test; do n=$(echo $t | tr ':' '-'); pnpm $t > $G/f-$n.log 2>&1; echo "pnpm $t EXIT $?" >> $S; done
pnpm build > $G/build.log 2>&1; rc=$?; echo "pnpm build EXIT $rc" >> $S
strip < $G/build.log | grep "phase timings" >> $S
if [ $rc -eq 0 ]; then
  bash ~/work/pr-164796-h/run-after.sh > $G/harness-run.out 2>&1; echo "harness run-after EXIT $?" >> $S
  bash ~/work/pr-164796-h/run-upgrade.sh > $G/harness-upgrade.out 2>&1; echo "harness run-upgrade EXIT $?" >> $S
  diff ~/work/pr-164796-h/ref/outcomes-after.txt ~/work/pr-164796-h/logs/outcomes-after.txt > $G/harness-outcomes.diff 2>&1; echo "harness outcomes raw diff vs r15 EXIT $? ($(wc -l < $G/harness-outcomes.diff | tr -d ' ') lines)" >> $S
fi
pnpm check:changed --base $BASE > $G/check-changed.log 2>&1; echo "check:changed --base $BASE EXIT $?" >> $S
strip < $G/check-changed.log | grep -E "^ *[0-9.]+m?s +failed" >> $S
echo "check:changed ok steps: $(strip < $G/check-changed.log | grep -cE '^ *[0-9.]+m?s +ok ')" >> $S
node --import ./scripts/tsx.mjs scripts/check-env-var-count.mts > $G/f-check-env-var-count.log 2>&1; echo "check-env-var-count EXIT $?" >> $S
git diff --check $BASE HEAD > $G/diff-check.log 2>&1; echo "git diff --check $BASE HEAD EXIT $?" >> $S
pnpm exec oxfmt --check $(git diff --name-only --diff-filter=AM $BASE HEAD | grep -E '\.(ts|tsx|js|mjs|json|md)$') > $G/oxfmt-check.log 2>&1; echo "oxfmt --check (changed files) EXIT $?" >> $S
for lane in src/agents/cli-runner/ extensions/anthropic/ src/plugin-sdk/provider-auth-claude-compat.test.ts src/agents/sessions/ src/config/sessions/; do
  n=$(echo $lane | tr '/.' '__')
  pnpm test $lane > $G/lane-$n.log 2>&1; echo "lane $lane EXIT $?" >> $S
  strip < $G/lane-$n.log | grep -E "^ FAIL |Test Files|Tests  |\[test\] (starting|passed|failed)" >> $S
done
echo "end: $(ident)" >> $S
echo "ALL DONE" >> $S
