#!/bin/bash
# merge6 gates at the merge of main cab0df90f87 into 57501c047f7 (generated baseline hash only).
cd ~/work/pr-164796-m6 || exit 1
export PATH=$HOME/homebrew/bin:$PATH OPENCLAW_VITEST_RUNTIME=node
G=$HOME/nas/outputs/pr-simplify/164796/merge6/gates; mkdir -p $G; S=$G/summary.txt
echo "HEAD $(git rev-parse HEAD) tree $(git rev-parse HEAD^{tree}) main $(git rev-parse origin/main) $(date)" > $S
step() { n=$1; shift; "$@" > $G/$n.log 2>&1; echo "$n exit=$?" >> $S; }
step tsgo-core pnpm tsgo:core
step tsgo-core-test pnpm tsgo:core:test
step tsgo-extensions pnpm tsgo:extensions
step tsgo-extensions-test pnpm tsgo:extensions:test
step madge pnpm check:madge-import-cycles
step build pnpm build
step build-ai node --import tsx scripts/tsdown-build.mts --config tsdown.ai.config.ts
step targeted pnpm test src/agents/cli-runner/history-boundary.native-login.test.ts src/agents/cli-runner/prepare-native-history.test.ts src/agents/cli-runner/execute.native-history-owner.test.ts src/agents/cli-runner/history-boundary.incognito.test.ts src/agents/cli-runner/history-boundary.test.ts src/agents/cli-runner/execute-plugin.test.ts src/agents/cli-runner/cli-live-session-registry.test.ts src/agents/cli-credentials.test.ts src/plugin-sdk/provider-auth-claude-compat.test.ts extensions/anthropic/cli-runtime.test.ts src/agents/embedded-agent-runner/run.session-prompt-state.test.ts
export OPENCLAW_E2E_USE_PREBUILT_DIST=1
for i in 1 2 3; do step e2e-compaction-$i node_modules/.bin/vitest run --config test/vitest/vitest.e2e.config.ts test/gateway-openai-compaction-replay.e2e.test.ts; done
echo "end $(date)" >> $S
