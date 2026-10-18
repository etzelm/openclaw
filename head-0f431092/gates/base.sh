#!/bin/bash
# Clean merged main ee2c67141c1: reproduce check failures, then RED with the branch's test files.
export PATH=$HOME/homebrew/bin:$PATH OPENCLAW_VITEST_MAX_WORKERS=3
B=~/work/merge-164796-main; T=~/work/merge-164796; G=~/work/merge-164796-gates; S=$G/base-summary.txt
strip() { sed 's/\x1b\[[0-9;]*m//g'; }
cd $B || exit 1
echo "base HEAD $(git rev-parse HEAD) dirty=$(git status --porcelain | wc -l | tr -d ' ')" > $S
node --import ./scripts/tsx.mjs scripts/check-max-lines-ratchet.mts --base HEAD~1 > $G/main-check-max-lines-ratchet.log 2>&1; echo "max-lines ratchet (main vs its parent) EXIT $?" >> $S
pnpm check:wrapper-shadowing > $G/main-check-wrapper-shadowing.log 2>&1; echo "wrapper shadowing EXIT $?" >> $S
node --import tsx scripts/check-deadcode-exports.mts > $G/main-check-deadcode.log 2>&1; echo "dead export scan EXIT $?" >> $S
node --import ./scripts/tsx.mjs scripts/check-env-var-count.mts > $G/main-check-env-var-count.log 2>&1; echo "env-var count EXIT $?" >> $S
echo "base dirty after checks=$(git status --porcelain | wc -l | tr -d ' ')" >> $S
FILES=$(git -C $T diff --name-only --diff-filter=AM HEAD 79a4c3bb3bc | grep -E '\.test\.ts$|\.test-harness\.ts$|\.test-support\.ts$')
for f in $FILES; do mkdir -p "$(dirname $f)"; git -C $T show 79a4c3bb3bc:$f > "$f"; done
echo "copied from 79a4c3bb3bc: $(echo $FILES)" >> $S
for f in $(echo "$FILES" | grep '\.test\.ts$'); do
  n=$(echo $f | tr '/.' '__')
  pnpm test $f > $G/red-$n.log 2>&1; rc=$?
  echo "== RED on main: $f EXIT $rc" >> $S
  strip < $G/red-$n.log | grep -E "Test Files|Tests  " >> $S
done
git checkout -q -- . && git clean -fdq -- src extensions
echo "base restored: $(git status --porcelain | wc -l | tr -d ' ') changes" >> $S
echo BASE DONE >> $S
