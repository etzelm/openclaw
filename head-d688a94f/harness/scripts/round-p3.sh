#!/bin/bash
# Pass 3: every capture at the new tree. Run after check:changed finished in ~/work/pr-164796.
L=~/work/pr-164796-logs/p3; mkdir -p $L
H=$HOME/work/pr-164796-h/harness; T=$HOME/work/pr-164796; B=$HOME/work/pr-164796-base
export OPENCLAW_VITEST_MAX_WORKERS=4
cd $T
echo "tree $(git rev-parse HEAD^{tree}) head $(git rev-parse HEAD) base $(git rev-parse main-now)" > $L/identity.txt
git status --porcelain >> $L/identity.txt
rm -rf .artifacts/dist-artifacts.lock
( time pnpm build ) > $L/build.log 2>&1; echo "EXIT $?" >> $L/build.log
grep -q "^EXIT 0" $L/build.log || { echo BUILD FAILED > $L/ALLDONE; exit 1; }
# Second checkout at the same commit: red/green and lint run there.
( rm -rf ~/work/pr-164796-mut && git clone -q $T ~/work/pr-164796-mut && cd ~/work/pr-164796-mut && git checkout -q $(git -C $T rev-parse HEAD) && git branch -f main-now $(git -C $T rev-parse main-now) && pnpm install --frozen-lockfile > $L/mut-install.log 2>&1
  echo "mut tree $(git rev-parse HEAD^{tree})" >> $L/identity.txt
  node scripts/check-changed.mjs --base main-now --timed > $L/check-changed.log 2>&1; echo "EXIT $?" >> $L/check-changed.log
  $H/redgreen.sh > $L/redgreen.log 2>&1
  F=$(git diff --name-only main-now HEAD -- "src/*.ts" | tr "\n" " ")
  { echo "## node scripts/run-oxlint.mjs --tsconfig config/tsconfig/oxlint.core.json <$(echo $F | wc -w | tr -d ' ') changed src files>"; node scripts/run-oxlint.mjs --tsconfig config/tsconfig/oxlint.core.json $F 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | tail -3
    echo "## node scripts/run-oxlint.mjs <3 changed extension files>"; node scripts/run-oxlint.mjs extensions/anthropic/cli.runtime.ts extensions/anthropic/cli-runtime.test.ts 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | tail -3
    echo "## pnpm format:docs:check"; pnpm format:docs:check 2>&1 | tail -2
    echo "## pnpm docs:check-links"; pnpm docs:check-links 2>&1 | tail -2
    echo "## pnpm docs:check-mdx"; pnpm docs:check-mdx 2>&1 | tail -2
    echo "## git diff --check main-now HEAD"; git diff --check main-now HEAD; echo "exit $?"
  } > $L/other-checks.log 2>&1
  echo done > $L/mut.done ) &
MUT=$!
rm -rf $H/runs/after-* $H/runs/base-* $H/runs/*.done
$H/run-all.sh $T after optout-allowed optin-withdrawn optin-later > $L/harness.log 2>&1
$H/run-all.sh $T after >> $L/harness.log 2>&1
$H/scenario2.sh $T after skill-config-dir-added >> $L/harness.log 2>&1
for s in interrupted-allowed interrupted-fresh interrupted-reassign-before-send interrupted-revoke-before-send interrupted-reassign-before-context interrupted-revoke-before-context; do $H/gateway-probe.sh $T after $s >> $L/harness.log 2>&1; done
PROBE_NOTE_HOOK=llm_output QUEUED_SWITCH_LOG=$H/runs/after-note-worker-commands.log EXTRA_NODE_OPTIONS="--import $H/shim/queued-switch-shim.mjs" $H/scenario.sh $T after note-resumed-allowed >> $L/harness.log 2>&1
UPGRADE_FROM=$HOME/work/pr-164796-rel/node_modules/openclaw UPGRADE_LABEL=v2026.10.2 $H/scenario.sh $T after upgrade >> $L/harness.log 2>&1
# Base control: current main has no opt-in key, so it runs with the key unset.
while [ ! -f ~/work/pr-164796-logs/base-build.done ]; do sleep 20; done
if grep -q "^EXIT 0" ~/work/pr-164796-logs/base-build.log; then
  HARNESS_ATTEST=0 $H/scenario.sh $B base allowed >> $L/harness.log 2>&1
  HARNESS_ATTEST=0 FAKE_WRITE_TRANSCRIPT=1 $H/scenario.sh $B base resumed-allowed >> $L/harness.log 2>&1
fi
echo "harness done" >> $L/harness.log
TARGETED="src/agents/cli-runner/history-boundary.test.ts src/agents/cli-runner/history-boundary.native-login.test.ts src/agents/cli-runner/history-boundary.native-login-metadata.test.ts src/agents/cli-runner/history-boundary.incognito.test.ts src/agents/cli-runner/execute.native-history-owner.test.ts src/agents/cli-runner/execute-plugin.test.ts src/agents/cli-runner/prepare-native-history.test.ts src/agents/cli-runner/cli-live-session-registry.test.ts src/agents/cli-runner/prepare.test.ts src/plugin-sdk/provider-auth-claude-compat.test.ts src/plugin-sdk/session-store-history-boundary.test.ts src/agents/cli-credentials.test.ts src/gateway/session-lifecycle-run-failure.test.ts extensions/anthropic/cli-runtime.test.ts extensions/anthropic/openclaw.plugin.test.ts src/config/sessions/session-accessor.sqlite-transcript-reports.test.ts src/config/sessions/session-transcript-report-facts.test.ts src/config/sessions/cli-history-owner-probe.test.ts"
pnpm test $TARGETED > $L/targeted.log 2>&1; echo "EXIT $?" >> $L/targeted.log
pnpm test src/agents/cli-runner/ > $L/lane-cli-runner.log 2>&1; echo "EXIT $?" >> $L/lane-cli-runner.log
pnpm test src/agents/sessions/ extensions/anthropic/ src/plugin-sdk/provider-auth*.test.ts src/plugin-sdk/session-store-history-boundary.test.ts src/agents/cli-credentials.test.ts > $L/lane-misc.log 2>&1; echo "EXIT $?" >> $L/lane-misc.log
pnpm test src/config/sessions/ > $L/lane-config-sessions.log 2>&1; echo "EXIT $?" >> $L/lane-config-sessions.log
wait $MUT
echo "tree after $(git rev-parse HEAD^{tree})" >> $L/identity.txt; git status --porcelain >> $L/identity.txt
echo ALLDONE > $L/ALLDONE
