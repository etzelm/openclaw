#!/bin/bash
# Pristine main 53bcf5095e7: reproduce the check failures, then RED with the branch's changed test files.
export PATH=$HOME/homebrew/bin:$PATH OPENCLAW_VITEST_MAX_WORKERS=4
B=~/work/pr-164796-simplify2-main; T=~/work/pr-164796-simplify2; G=~/work/pr-164796-simplify2-gates; S=$G/base-summary.txt
MB=53bcf5095e74fd2e8323b16a507e4ca3d4a2c6b2; HEADSHA=148b78f9f4add3020ce9b983c9afc1a190cd40b2
strip() { sed 's/\x1b\[[0-9;]*m//g'; }
while ! grep -q "POST DONE" $G/summary-post.txt 2>/dev/null; do sleep 30; done
cd $B || exit 1
pnpm install --frozen-lockfile > $G/main-install.log 2>&1; echo "main install EXIT $?" > $S
echo "base HEAD $(git rev-parse HEAD) dirty=$(git status --porcelain | wc -l | tr -d ' ')" >> $S
node --import ./scripts/tsx.mjs scripts/check-max-lines-ratchet.mts --base $MB > $G/main-check-max-lines-ratchet.log 2>&1; echo "max-lines ratchet on main, --base main itself (empty diff) EXIT $?" >> $S
strip < $G/main-check-max-lines-ratchet.log | grep "^  " >> $S
node --import ./scripts/tsx.mjs scripts/check-tsgo-core-boundary.mts > $G/main-check-tsgo-core-boundary.log 2>&1; echo "core tsgo graph boundary on main EXIT $?" >> $S
strip < $G/main-check-tsgo-core-boundary.log | grep "test roots" >> $S
node --import tsx scripts/check-deadcode-exports.mts > $G/main-check-deadcode.log 2>&1; echo "dead export scan on main EXIT $?" >> $S
node --import ./scripts/tsx.mjs scripts/check-env-var-count.mts > $G/main-check-env-var-count.log 2>&1; echo "env-var count on main EXIT $?" >> $S
strip < $G/main-check-env-var-count.log | tail -1 >> $S
strip < $G/main-check-deadcode.log | grep -E "^  [a-z].*: " | sort > $G/main-dead.txt
strip < $G/check-changed.log | sed -n '/dead export scan (skip/,/\[check:changed\]/p' | grep -E "^  [a-z].*: " | sort > $G/pr-dead.txt
echo "dead exports main $(wc -l < $G/main-dead.txt) pr $(wc -l < $G/pr-dead.txt) identical=$(cmp -s $G/main-dead.txt $G/pr-dead.txt && echo yes || echo no)" >> $S
echo "base dirty after checks=$(git status --porcelain | wc -l | tr -d ' ')" >> $S
FILES=$(git -C $T diff --name-only --diff-filter=AM $MB $HEADSHA | grep -E '\.test\.ts$|\.test-support\.ts$')
for f in $FILES; do mkdir -p "$(dirname $f)"; git -C $T show $HEADSHA:$f > "$f"; done
echo "copied from $HEADSHA: $(echo $FILES)" >> $S
for f in $(echo "$FILES" | grep '\.test\.ts$'); do
  n=$(echo $f | tr '/.' '__')
  pnpm test $f > $G/red-$n.log 2>&1; rc=$?
  echo "== RED on main: $f EXIT $rc" >> $S
  strip < $G/red-$n.log | grep -E "Test Files|Tests  " >> $S
done
git checkout -q -- . && git clean -fdq -- src extensions
echo "base restored: $(git status --porcelain | wc -l | tr -d ' ') changes" >> $S
echo BASE DONE >> $S
