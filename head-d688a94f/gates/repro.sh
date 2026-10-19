#!/bin/bash
# config/sessions lane failure: reproduce alone on the tree and on pristine main, then rerun the full lane.
export PATH=$HOME/homebrew/bin:$PATH OPENCLAW_VITEST_MAX_WORKERS=4
G=~/work/pr-164796-simplify2-gates; S=$G/repro-summary.txt; T=~/work/pr-164796-simplify2; B=~/work/pr-164796-simplify2-main
strip() { sed 's/\x1b\[[0-9;]*m//g'; }
while ! grep -q "BASE DONE" $G/base-summary.txt 2>/dev/null; do sleep 30; done
F="src/config/sessions/session-transcript-reconcile.lifecycle.test.ts src/config/sessions/legacy-main-session-migration.test.ts src/config/sessions/session-accessor.sqlite-entry-admission.test.ts"
echo "start $(date) load $(uptime | sed 's/.*averages: //')" > $S
for side in tree main; do
  [ $side = tree ] && D=$T || D=$B
  cd $D; echo "== $side $(git rev-parse HEAD) dirty=$(git status --porcelain | wc -l | tr -d ' ')" >> $S
  for f in $F; do n=$(echo $f | tr '/.' '__')
    pnpm test $f > $G/repro-$side-$n.log 2>&1; rc=$?
    echo "alone $f EXIT $rc" >> $S; strip < $G/repro-$side-$n.log | grep -E "Test Files|Tests  " >> $S
  done
done
cd $T; echo "== full lane rerun on tree, load $(uptime | sed 's/.*averages: //')" >> $S
pnpm test src/config/sessions/ > $G/repro-tree-lane-config-sessions.log 2>&1; rc=$?
echo "lane src/config/sessions/ rerun EXIT $rc load $(uptime | sed 's/.*averages: //')" >> $S
strip < $G/repro-tree-lane-config-sessions.log | grep -E "Test Files|Tests  |\[test\] (passed|failed)" >> $S
strip < $G/repro-tree-lane-config-sessions.log | grep -E "^ FAIL " | awk '{print $3}' | sort | uniq -c >> $S
if [ $rc -ne 0 ]; then
  cd $B; echo "== full lane on main, load $(uptime | sed 's/.*averages: //')" >> $S
  pnpm test src/config/sessions/ > $G/repro-main-lane-config-sessions.log 2>&1; rc2=$?
  echo "lane src/config/sessions/ on main EXIT $rc2" >> $S
  strip < $G/repro-main-lane-config-sessions.log | grep -E "Test Files|Tests  |\[test\] (passed|failed)" >> $S
  strip < $G/repro-main-lane-config-sessions.log | grep -E "^ FAIL " | awk '{print $3}' | sort | uniq -c >> $S
fi
echo "REPRO DONE $(date)" >> $S
