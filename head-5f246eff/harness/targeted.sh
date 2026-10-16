cd ~/work/pr164796
export OPENCLAW_VITEST_MAX_WORKERS=8
F="src/agents/cli-runner/history-boundary.test.ts src/agents/cli-runner/history-boundary.native-login.test.ts src/agents/cli-runner/history-boundary.native-login-metadata.test.ts src/agents/cli-runner/history-boundary.incognito.test.ts src/agents/cli-runner/execute.native-history-owner.test.ts src/agents/cli-runner/execute-plugin.test.ts src/agents/cli-runner/prepare-native-history.test.ts src/agents/cli-runner/cli-live-session-registry.test.ts src/agents/cli-runner/prepare.test.ts src/plugin-sdk/provider-auth-claude-compat.test.ts src/plugin-sdk/session-store-history-boundary.test.ts src/agents/cli-credentials.test.ts src/gateway/session-lifecycle-run-failure.test.ts extensions/anthropic/cli-runtime.test.ts extensions/anthropic/openclaw.plugin.test.ts src/config/sessions/session-accessor.sqlite-transcript-reports.test.ts src/config/sessions/session-transcript-report-facts.test.ts src/config/sessions/cli-history-owner-probe.test.ts"
for f in $F; do [ -f $f ] || echo "MISSING $f"; done
node --import ./scripts/tsx.mjs scripts/test-projects.mts $F
echo EXIT $?
