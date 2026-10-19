#!/bin/bash
# Pristine main 372095136ef: reproduce failing checks, RED with the branch's changed test files, and (only if the
# config/sessions lane failed at the tree) its failing files alone on both trees plus the full lane on a built main.
export PATH=$HOME/homebrew/bin:$PATH OPENCLAW_VITEST_MAX_WORKERS=4
B=~/work/pr-164796-merge3-main; T=~/work/pr-164796-merge3; G=~/work/pr-164796-merge3-gates; S=$G/base-summary.txt
MB=372095136effb8dcaf2d9e59ace8bae193a6573b; HEADSHA=a7f6d8a88c7b6069fcba53840378619533a6e377
strip() { sed 's/\x1b\[[0-9;]*m//g'; }
load() { uptime | sed 's/.*averages: //'; }
while [ ! -f $G/gates.done ]; do sleep 30; done
cd $B || exit 1
echo "base HEAD $(git rev-parse HEAD) dirty=$(git status --porcelain | wc -l | tr -d ' ') $(tail -1 $G/main-install.log) start $(date)" > $S
for c in $(strip < $G/check-changed.log | grep -E "^ *[0-9.]+m?s +failed" | sed -E 's/^ *[0-9.]+m?s +failed +//' | tr ' ' '_'); do echo "check:changed failed step on tree: $c" >> $S; done
node --import ./scripts/tsx.mjs scripts/check-max-lines-ratchet.mts --base $MB > $G/main-check-max-lines-ratchet.log 2>&1; echo "max-lines ratchet on main, --base main itself EXIT $?" >> $S
strip < $G/main-check-max-lines-ratchet.log | grep "^  " >> $S
node --import ./scripts/tsx.mjs scripts/check-tsgo-core-boundary.mts > $G/main-check-tsgo-core-boundary.log 2>&1; echo "core tsgo graph boundary on main EXIT $?" >> $S
strip < $G/main-check-tsgo-core-boundary.log | grep "test roots" >> $S
node --import tsx scripts/check-deadcode-exports.mts > $G/main-check-deadcode.log 2>&1; echo "dead export scan on main EXIT $?" >> $S
node --import ./scripts/tsx.mjs scripts/check-env-var-count.mts > $G/main-check-env-var-count.log 2>&1; echo "env-var count on main EXIT $?" >> $S
strip < $G/main-check-env-var-count.log | tail -1 >> $S
strip < $G/main-check-deadcode.log | grep -E "^  [a-z].*: " | sort > $G/main-dead.txt
strip < $G/check-changed.log | sed -n '/dead export scan (skip/,/\[check:changed\]/p' | grep -E "^  [a-z].*: " | sort > $G/pr-dead.txt
echo "dead exports main $(wc -l < $G/main-dead.txt | tr -d ' ') pr $(wc -l < $G/pr-dead.txt | tr -d ' ') identical=$(cmp -s $G/main-dead.txt $G/pr-dead.txt && echo yes || echo no)" >> $S
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
if grep -q "^lane src/config/sessions/ EXIT [1-9]" $G/summary.txt; then
  R=$G/repro-summary.txt; echo "config/sessions lane failed at the tree; repro start $(date) load $(load)" > $R
  F=$(strip < $G/lane-src_config_sessions_.log | grep -E "^ FAIL " | awk '{print $3}' | sort -u | head -8)
  echo "failing files: $(echo $F)" >> $R
  for side in tree main; do [ $side = tree ] && cd $T || cd $B
    echo "== $side $(git rev-parse HEAD) dirty=$(git status --porcelain | wc -l | tr -d ' ')" >> $R
    for f in $F; do n=$(echo $f | tr '/.' '__'); pnpm test $f > $G/repro-$side-$n.log 2>&1; rc=$?
      echo "alone $f EXIT $rc load $(load)" >> $R; strip < $G/repro-$side-$n.log | grep -E "Test Files|Tests  " >> $R; done
  done
  cd $B; pnpm build > $G/main-build.log 2>&1; echo "main build EXIT $?" >> $R
  pnpm test src/config/sessions/ > $G/repro-main-lane-config-sessions.log 2>&1; rc=$?
  echo "lane src/config/sessions/ on main EXIT $rc load $(load)" >> $R
  strip < $G/repro-main-lane-config-sessions.log | grep -E "^ FAIL |Test Files|Tests  |\[test\] (passed|failed)" | sort -u | head -30 >> $R
  cd $T; pnpm test src/config/sessions/ > $G/repro-tree-lane-config-sessions.log 2>&1; rc=$?
  echo "lane src/config/sessions/ rerun on tree EXIT $rc load $(load)" >> $R
  strip < $G/repro-tree-lane-config-sessions.log | grep -E "^ FAIL |Test Files|Tests  |\[test\] (passed|failed)" | sort -u | head -30 >> $R
  echo "REPRO DONE $(date)" >> $R
fi
echo "BASE DONE $(date)" >> $S
