#!/bin/bash
# Pass 3, final tree: tests, lanes, check:changed, red/green, lint; then rebuild and compare dist.
L=~/work/pr-164796-logs/p3; H=$HOME/work/pr-164796-h/harness; T=$HOME/work/pr-164796
export OPENCLAW_VITEST_MAX_WORKERS=4
cd $T
echo "final tree $(git rev-parse HEAD^{tree}) head $(git rev-parse HEAD) base $(git rev-parse main-now)" >> $L/identity.txt
git status --porcelain >> $L/identity.txt
( rm -rf ~/work/pr-164796-mut && git clone -q $T ~/work/pr-164796-mut && cd ~/work/pr-164796-mut && git checkout -q $(git -C $T rev-parse HEAD) && git branch -f main-now $(git -C $T rev-parse main-now) && pnpm install --frozen-lockfile > $L/mut-install.log 2>&1
  echo "mut tree $(git rev-parse HEAD^{tree})" >> $L/identity.txt
  node scripts/check-changed.mjs --base main-now --timed > $L/check-changed.log 2>&1; echo "EXIT $?" >> $L/check-changed.log
  $H/redgreen.sh > $L/redgreen.log 2>&1
  F=$(git diff --name-only main-now HEAD -- "src/*.ts" | tr "\n" " ")
  { echo "## node scripts/run-oxlint.mjs --tsconfig config/tsconfig/oxlint.core.json <$(echo $F | wc -w | tr -d ' ') changed src files>"; node scripts/run-oxlint.mjs --tsconfig config/tsconfig/oxlint.core.json $F 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | tail -3
    echo "## node scripts/run-oxlint.mjs <2 changed extension files>"; node scripts/run-oxlint.mjs extensions/anthropic/cli.runtime.ts extensions/anthropic/cli-runtime.test.ts 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | tail -3
    echo "## pnpm format:docs:check"; pnpm format:docs:check 2>&1 | tail -2
    echo "## pnpm docs:check-links"; pnpm docs:check-links 2>&1 | tail -2
    echo "## pnpm docs:check-mdx"; pnpm docs:check-mdx 2>&1 | tail -2
    echo "## git diff --check main-now HEAD"; git diff --check main-now HEAD; echo "exit $?"
    echo "## git status --porcelain (mut, after all checks)"; git status --porcelain; echo "(end)"
  } > $L/other-checks.log 2>&1
  echo done > $L/mut.done ) &
MUT=$!
TARGETED="src/agents/cli-runner/history-boundary.test.ts src/agents/cli-runner/history-boundary.native-login.test.ts src/agents/cli-runner/history-boundary.native-login-metadata.test.ts src/agents/cli-runner/history-boundary.incognito.test.ts src/agents/cli-runner/execute.native-history-owner.test.ts src/agents/cli-runner/execute-plugin.test.ts src/agents/cli-runner/prepare-native-history.test.ts src/agents/cli-runner/cli-live-session-registry.test.ts src/agents/cli-runner/prepare.test.ts src/plugin-sdk/provider-auth-claude-compat.test.ts src/plugin-sdk/session-store-history-boundary.test.ts src/agents/cli-credentials.test.ts src/gateway/session-lifecycle-run-failure.test.ts extensions/anthropic/cli-runtime.test.ts extensions/anthropic/openclaw.plugin.test.ts src/config/sessions/session-accessor.sqlite-transcript-reports.test.ts src/config/sessions/session-transcript-report-facts.test.ts src/config/sessions/cli-history-owner-probe.test.ts"
pnpm test $TARGETED > $L/targeted.log 2>&1; echo "EXIT $?" >> $L/targeted.log
pnpm test src/agents/cli-runner/ > $L/lane-cli-runner.log 2>&1; echo "EXIT $?" >> $L/lane-cli-runner.log
pnpm test src/agents/sessions/ extensions/anthropic/ src/plugin-sdk/provider-auth*.test.ts src/plugin-sdk/session-store-history-boundary.test.ts src/agents/cli-credentials.test.ts > $L/lane-misc.log 2>&1; echo "EXIT $?" >> $L/lane-misc.log
pnpm test src/config/sessions/ > $L/lane-config-sessions.log 2>&1; echo "EXIT $?" >> $L/lane-config-sessions.log
wait $MUT
while [ ! -f $L/harness2.done ]; do sleep 20; done
rm -rf .artifacts/dist-artifacts.lock
( time pnpm build ) > $L/build2.log 2>&1; echo "EXIT $?" >> $L/build2.log
(cd dist && find . -type f -print0 | sort -z | xargs -0 shasum -a 256) > $L/dist-hashes-build2.txt
diff $L/dist-hashes-build1.txt $L/dist-hashes-build2.txt > $L/dist-hashes.diff; echo "diff exit $?" >> $L/dist-hashes.diff
echo "tree after $(git rev-parse HEAD^{tree})" >> $L/identity.txt; git status --porcelain >> $L/identity.txt
echo ALLDONE > $L/ALLDONE
