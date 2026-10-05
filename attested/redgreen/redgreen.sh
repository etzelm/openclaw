#!/bin/bash
# New test files run against the published head's production code (prev worktree), each alone.
set -u
export PATH=$HOME/homebrew/bin:$PATH OPENCLAW_VITEST_MAX_WORKERS=8
A=$HOME/work/164796-c/after; P=$HOME/work/164796-c/prev; OUT=$HOME/work/164796-c/redgreen
rm -rf $OUT; mkdir -p $OUT
FILES="src/plugin-sdk/provider-auth-claude-compat.test.ts src/agents/cli-credentials.test.ts src/agents/cli-runner/history-boundary.test.ts src/agents/cli-runner/history-boundary.native-login.test.ts src/agents/cli-runner/prepare-native-history.test.ts src/agents/cli-runner/execute.native-history-owner.test.ts"
for f in $FILES src/agents/cli-runner/history-boundary.test-support.ts; do cp "$A/$f" "$P/$f"; done
cd $P
for f in $FILES; do
  n=$(basename $f .ts)
  { echo "\$ pnpm test $f   (tests from $(git -C $A rev-parse --short HEAD), production from $(git rev-parse --short HEAD))"; pnpm test $f; } > $OUT/$n.log 2>&1
  echo $? > $OUT/$n.exit
done
git checkout -- . && rm -f src/agents/cli-runner/history-boundary.native-login.test.ts src/agents/cli-runner/history-boundary.test-support.ts
git status --porcelain > $OUT/prev-status-after.txt
touch $OUT/done
