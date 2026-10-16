#!/bin/bash
cd ~/work/pr-164796 || exit 1
export PATH=$HOME/homebrew/bin:$PATH
export OPENCLAW_VITEST_MAX_WORKERS=4
G=~/work/pr-164796-gates
strip() { sed 's/\x1b\[[0-9;]*m//g'; }
echo "HEAD $(git rev-parse HEAD) TREE $(git rev-parse HEAD^{tree})" > $G/identity.txt
grep -rn '^<<<<<<<\|^>>>>>>>' src extensions docs --include=*.ts --include=*.md --include=*.json -l > $G/markers.txt; echo "markers: $(wc -l < $G/markers.txt)" >> $G/identity.txt
for t in tsgo:core tsgo:core:test tsgo:extensions tsgo:extensions:test; do
  pnpm $t > $G/f-$t.log 2>&1; echo "$t EXIT $?" >> $G/summary.txt
done
for lane in src/agents/cli-runner/ extensions/anthropic/ src/plugin-sdk/provider-auth-claude-compat.test.ts; do
  n=$(echo $lane | tr '/.' '__')
  pnpm test $lane > $G/f-lane-$n.log 2>&1; echo "lane $lane EXIT $?" >> $G/summary.txt
  strip < $G/f-lane-$n.log | grep -E "Test Files|Tests  |\[test\]" >> $G/summary.txt
done
node scripts/check-changed.mjs --base gh/main > $G/f-check-changed.log 2>&1; echo "check-changed EXIT $?" >> $G/summary.txt
strip < $G/f-check-changed.log | grep -E "^(ok|failed|FAIL|fail)|failed" | head -20 >> $G/summary.txt
for lane in src/agents/sessions/ src/config/sessions/; do
  n=$(echo $lane | tr '/.' '__')
  pnpm test $lane > $G/f-lane-$n.log 2>&1; echo "lane $lane EXIT $?" >> $G/summary.txt
  strip < $G/f-lane-$n.log | grep -E "^ FAIL |Test Files|Tests  |\[test\]" >> $G/summary.txt
done
echo "ALL DONE" >> $G/summary.txt
