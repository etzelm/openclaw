#!/bin/bash
cd ~/work/pr-164796-merge4 || exit 1
export PATH=$HOME/homebrew/bin:$PATH
export OPENCLAW_VITEST_MAX_WORKERS=8
G=.m4/gates; mkdir -p $G
S=$G/summary.txt
MAIN=79506514289f3d51342af165dc0f6f9c0638a40b
echo "tree=$(git rev-parse HEAD) tree-sha=$(git rev-parse 'HEAD^{tree}') main=$MAIN start $(date)" > $S
step() { name=$1; shift; echo "== $name start $(date +%T) load=$(uptime | sed 's/.*averages: //')" >> $S; "$@" > $G/$name.log 2>&1; rc=$?; echo "$name exit=$rc $(date +%T)" >> $S; return $rc; }
step build pnpm build || { echo "BUILD FAILED, stop" >> $S; echo done > $G/done; exit 1; }
step tsgo-core pnpm tsgo:core
step tsgo-core-test pnpm tsgo:core:test
step tsgo-extensions pnpm tsgo:extensions
step tsgo-extensions-test pnpm tsgo:extensions:test
C=src/agents/cli-runner
step targeted pnpm test $C/history-boundary.native-login.test.ts $C/prepare-native-history.test.ts $C/execute.native-history-owner.test.ts extensions/anthropic/cli-runtime.test.ts $C/execute-plugin.test.ts $C/cli-live-session-registry.test.ts src/agents/cli-credentials.test.ts src/plugin-sdk/provider-auth-claude-compat.test.ts $C/history-boundary.test.ts $C/history-boundary.incognito.test.ts
step lane-cli-runner pnpm test src/agents/cli-runner/
step lane-anthropic pnpm test extensions/anthropic/
step lane-compat pnpm test src/plugin-sdk/provider-auth-claude-compat.test.ts
step lane-agents-sessions pnpm test src/agents/sessions/
step lane-config-sessions pnpm test src/config/sessions/
step diff-check git diff --check $MAIN HEAD
git diff --name-only --diff-filter=AM $MAIN HEAD | grep -E '\.(ts|tsx|mts|mjs|js|json|md)$' > $G/changed-files.txt
step oxfmt npx oxfmt --check $(cat $G/changed-files.txt)
step check-changed pnpm check:changed --base $MAIN
step madge pnpm check:madge-import-cycles
for f in $G/*.log; do sed 's/\x1b\[[0-9;]*m//g' $f | grep -E "Test Files |Tests  |\[test\] (passed|failed)|^ FAIL " | sed "s|^|$(basename $f .log): |" ; done > $G/vitest-lines.txt
echo "end $(date)" >> $S
echo done > $G/done
