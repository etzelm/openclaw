#!/bin/bash
# Head control for the src/config/sessions failure (alone, twice), then the rest of the lane.
L=~/work/pr-164796-logs/p3; F=src/config/sessions/startup-migration.registry-recovery.test.ts
export OPENCLAW_VITEST_MAX_WORKERS=4
strip() { sed 's/\x1b\[[0-9;]*m//g'; }
while [ ! -f $L/ALLDONE ]; do sleep 20; done
cd ~/work/pr-164796
{ echo "## head $(git rev-parse --short=11 HEAD)"
  for i in 1 2; do pnpm test $F 2>&1 | strip | grep -E "^ FAIL |Tests  "; done; } >> $L/base-control-sesscontrol.log 2>&1
REST=$(git ls-files 'src/config/sessions/*.test.ts' 'src/config/sessions/**/*.test.ts' | grep -v "^$F$" | sort -u | tr '\n' ' ')
echo "pnpm test <$(echo $REST | wc -w | tr -d ' ') files: every src/config/sessions test file except $F>" > $L/lane-config-sessions-rest.log
pnpm test $REST >> $L/lane-config-sessions-rest.log 2>&1; echo "EXIT $?" >> $L/lane-config-sessions-rest.log
echo done > $L/sesscontrol.done
