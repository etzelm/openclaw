#!/bin/bash
# Red/green on the PR (head 53ff5be1f3b vs fix d20c06b61fb), then gates on the fix tree.
cd ~/work/pr-164796-cr || exit 1
export PATH=$HOME/homebrew/bin:$PATH OPENCLAW_VITEST_RUNTIME=node OPENCLAW_E2E_USE_PREBUILT_DIST=1 OPENCLAW_VITEST_MAX_WORKERS=8
O=~/work/pr-164796-cr-out/gates; mkdir -p $O; G=$O/gates.txt; : > $G
g() { echo "$*" >> $G; }
strip() { sed 's/\x1b\[[0-9;]*m//g' "$1"; }
e2e3() { # name
  for i in 1 2 3; do
    node_modules/.bin/vitest run --config test/vitest/vitest.e2e.config.ts test/gateway-openai-compaction-replay.e2e.test.ts > $O/e2e-$1-$i.log 2>&1; rc=$?
    g "e2e $1 run $i rc=$rc $(strip $O/e2e-$1-$i.log | grep -E 'AssertionError|Tests  ' | head -1)"
  done
}
build() { # name
  pnpm build > $O/build-$1.log 2>&1; rc=$?; g "build $1 rc=$rc"
  node --import tsx scripts/tsdown-build.mts --config tsdown.ai.config.ts > $O/build-ai-$1.log 2>&1; g "build-ai $1 rc=$?"
  return $rc
}
git checkout -q --detach 53ff5be1f3b1887519fce52dc145323c2d671817 || exit 1
g "== PR head $(git rev-parse HEAD) $(date)"
pnpm install --frozen-lockfile > $O/install-head.log 2>&1; g "install head rc=$?"
build head && e2e3 head
git checkout -q fix-pr || exit 1
g "== fix $(git rev-parse HEAD) tree $(git rev-parse HEAD^{tree}) dirty=$(git status --porcelain | grep -v '^??' | wc -l | tr -d ' ') $(date)"
build fix || { g DONE; exit 1; }
e2e3 fix
pnpm test src/agents/embedded-agent-runner/ > $O/lane-embedded-agent-runner.log 2>&1; rc=$?
g "lane src/agents/embedded-agent-runner/ rc=$rc $(strip $O/lane-embedded-agent-runner.log | grep -E '\[test\] (passed|failed)|Test Files|Tests  ' | tail -3 | tr '\n' ' ')"
for t in tsgo:core tsgo:core:test tsgo:extensions tsgo:extensions:test; do
  pnpm $t > $O/$t.log 2>&1; g "pnpm $t rc=$?"
done
pnpm test src/agents/cli-runner/history-boundary.native-login.test.ts src/agents/cli-runner/prepare-native-history.test.ts src/agents/cli-runner/execute.native-history-owner.test.ts src/agents/cli-runner/history-boundary.incognito.test.ts src/agents/cli-runner/history-boundary.test.ts src/agents/cli-runner/execute-plugin.test.ts src/agents/cli-runner/cli-live-session-registry.test.ts src/agents/cli-credentials.test.ts src/plugin-sdk/provider-auth-claude-compat.test.ts extensions/anthropic/cli-runtime.test.ts > $O/targeted.log 2>&1; rc=$?
g "targeted PR files rc=$rc $(strip $O/targeted.log | grep -E '\[test\] (passed|failed)' | tail -1)"
pnpm check:madge-import-cycles > $O/madge.log 2>&1; g "madge rc=$? $(grep -E 'cycle' $O/madge.log | tail -1)"
FILES=$(git diff --name-only --diff-filter=ACMR 79506514289 HEAD)
node_modules/.bin/oxfmt --check $FILES > $O/oxfmt.log 2>&1; g "oxfmt --check ($(echo $FILES | wc -w | tr -d ' ') files vs 79506514289) rc=$? $(tail -1 $O/oxfmt.log)"
git diff --check 53ff5be1f3b HEAD > $O/diff-check.log 2>&1; g "git diff --check 53ff5be1f3b..HEAD rc=$?"
for i in 1 2 3; do
  node_modules/.bin/vitest run --config test/vitest/vitest.gateway-server-isolated.config.ts src/gateway/server.chat-cli-auth.test.ts > $O/chat-cli-auth-$i.log 2>&1; rc=$?
  g "server.chat-cli-auth run $i rc=$rc $(strip $O/chat-cli-auth-$i.log | grep -E 'Tests  ' | head -1)"
done
for i in 1 2 3; do
  node_modules/.bin/vitest run --config test/vitest/vitest.gateway-database-workers.config.ts src/gateway/worker-environments/worker-turn-launcher.test.ts > $O/worker-turn-launcher-$i.log 2>&1; rc=$?
  g "worker-turn-launcher run $i rc=$rc $(strip $O/worker-turn-launcher-$i.log | grep -E 'Tests  ' | head -1)"
done
g "DONE $(date)"
