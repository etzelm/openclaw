#!/bin/bash
# merge6 lanes at 5e350e8aeb0 (merge of main cab0df90f87 into 57501c047f7, incognito import restored).
cd ~/work/pr-164796-m6 || exit 1
export PATH=$HOME/homebrew/bin:$PATH OPENCLAW_VITEST_RUNTIME=node
G=$HOME/nas/outputs/pr-simplify/164796/merge6/gates; S=$G/summary.txt
echo "lanes HEAD $(git rev-parse HEAD) tree $(git rev-parse HEAD^{tree}) dirty=$(git status --porcelain | wc -l | tr -d ' ') $(date)" >> $S
step() { n=$1; shift; "$@" > $G/$n.log 2>&1; echo "$n exit=$?" >> $S; }
step tsgo-core-test-2 pnpm tsgo:core:test
step targeted-2 pnpm test src/agents/cli-runner/history-boundary.native-login.test.ts src/agents/cli-runner/prepare-native-history.test.ts src/agents/cli-runner/execute.native-history-owner.test.ts src/agents/cli-runner/history-boundary.incognito.test.ts src/agents/cli-runner/history-boundary.test.ts src/agents/cli-runner/execute-plugin.test.ts src/agents/cli-runner/cli-live-session-registry.test.ts src/agents/cli-credentials.test.ts src/plugin-sdk/provider-auth-claude-compat.test.ts extensions/anthropic/cli-runtime.test.ts src/agents/embedded-agent-runner/run.session-prompt-state.test.ts
step lane-cli-runner pnpm test src/agents/cli-runner/
step lane-anthropic pnpm test extensions/anthropic/
step lane-agents-sessions pnpm test src/agents/sessions/
step lane-embedded-agent-runner pnpm test src/agents/embedded-agent-runner/
step lane-config-sessions pnpm test src/config/sessions/
step diff-check git diff --check origin/main HEAD
echo "lanes end $(date)" >> $S
