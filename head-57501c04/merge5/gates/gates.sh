#!/bin/bash
# merge5 gates at the merge commit, then the three CI tests 3x each. One step at a time.
cd ~/work/pr-164796-m5 || exit 1
export PATH=$HOME/homebrew/bin:$PATH
export OPENCLAW_VITEST_MAX_WORKERS=8
G=.m5/gates; mkdir -p $G
S=$G/summary.txt
MAIN=051bf6fa4d05e0870d0f360aee7ac1643cbb787d
echo "head=$(git rev-parse HEAD) tree=$(git rev-parse 'HEAD^{tree}') main=$MAIN dirty=$(git status --porcelain | wc -l | tr -d ' ') start $(date)" > $S
step() { name=$1; shift; echo "== $name start $(date +%T) load=$(uptime | sed 's/.*averages: //')" >> $S; "$@" > $G/$name.log 2>&1; rc=$?; echo "$name exit=$rc $(date +%T)" >> $S; return $rc; }
step build pnpm build || { echo "BUILD FAILED, stop" >> $S; echo done > $G/done; exit 1; }
step build-ai node --import tsx scripts/tsdown-build.mts --config tsdown.ai.config.ts
step tsgo-core pnpm tsgo:core
step tsgo-core-test pnpm tsgo:core:test
step tsgo-extensions pnpm tsgo:extensions
step tsgo-extensions-test pnpm tsgo:extensions:test
C=src/agents/cli-runner
step targeted pnpm test $C/history-boundary.native-login.test.ts $C/prepare-native-history.test.ts $C/execute.native-history-owner.test.ts $C/history-boundary.incognito.test.ts $C/history-boundary.test.ts $C/execute-plugin.test.ts $C/cli-live-session-registry.test.ts src/agents/cli-credentials.test.ts src/plugin-sdk/provider-auth-claude-compat.test.ts extensions/anthropic/cli-runtime.test.ts src/agents/embedded-agent-runner/run.session-prompt-state.test.ts
step lane-cli-runner pnpm test src/agents/cli-runner/
step lane-anthropic pnpm test extensions/anthropic/
step lane-compat pnpm test src/plugin-sdk/provider-auth-claude-compat.test.ts
step lane-agents-sessions pnpm test src/agents/sessions/
step lane-config-sessions pnpm test src/config/sessions/
step lane-embedded-agent-runner pnpm test src/agents/embedded-agent-runner/
step diff-check git diff --check $MAIN HEAD
git diff --name-only --diff-filter=AM $MAIN HEAD | grep -E '\.(ts|tsx|mts|mjs|js|json|md)$' > $G/changed-files.txt
step oxfmt node_modules/.bin/oxfmt --check $(cat $G/changed-files.txt)
step check-changed pnpm check:changed --base $MAIN
step madge pnpm check:madge-import-cycles
# The three CI tests that failed at 53ff5be1f3b, 3 runs each.
export OPENCLAW_VITEST_RUNTIME=node OPENCLAW_E2E_USE_PREBUILT_DIST=1
for i in 1 2 3; do step ci-e2e-compaction-$i node_modules/.bin/vitest run --config test/vitest/vitest.e2e.config.ts test/gateway-openai-compaction-replay.e2e.test.ts; done
for i in 1 2 3; do step ci-chat-cli-auth-$i node_modules/.bin/vitest run --config test/vitest/vitest.gateway-server-isolated.config.ts src/gateway/server.chat-cli-auth.test.ts; done
for i in 1 2 3; do step ci-worker-turn-launcher-$i node_modules/.bin/vitest run --config test/vitest/vitest.gateway-database-workers.config.ts src/gateway/worker-environments/worker-turn-launcher.test.ts; done
for f in $G/*.log; do sed 's/\x1b\[[0-9;]*m//g' $f | grep -E "Test Files |Tests  |\[test\] (passed|failed)|^ FAIL |AssertionError" | sed "s|^|$(basename $f .log): |" ; done > $G/vitest-lines.txt
echo "end head=$(git rev-parse HEAD) dirty=$(git status --porcelain | wc -l | tr -d ' ') $(date)" >> $S
echo done > $G/done
