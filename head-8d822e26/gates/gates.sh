#!/bin/bash
# Round 3 proof driver at the final tree. Every step logs to G/<name>.log and appends "name rc=N secs=S" to G/summary.txt.
cd ~/work/pr-164796-simplify3 || exit 1
export PATH=$HOME/homebrew/bin:$PATH
G=~/work/s3out/gates/final2; mkdir -p $G
S=$G/summary.txt
ident() { echo "$(date '+%F %T') $1 HEAD=$(git rev-parse HEAD) tree=$(git rev-parse HEAD^{tree}) dirty=$(git status --porcelain | wc -l | tr -d ' ') load=$(sysctl -n vm.loadavg)" >> $G/identity.txt; }
step() { name=$1; shift; ident "before $name"; t=$(date +%s); "$@" > $G/$name.log 2>&1; rc=$?; echo "$name rc=$rc secs=$(( $(date +%s) - t ))" >> $S; ident "after $name"; return $rc; }
echo "start $(date)" >> $S
# A: mutation matrix (production restored after each; aborts if dirty)
# green verbose per group for the case list
# B: build (fence for wide lanes)
step build pnpm build || { echo "build failed, stopping" >> $S; exit 1; }
# C: type checks
step tsgo-core pnpm tsgo:core
step tsgo-core-test pnpm tsgo:core:test
step tsgo-extensions pnpm tsgo:extensions
step tsgo-extensions-test pnpm tsgo:extensions:test
# D: targeted: every test file the PR adds or changes, plus the incognito suite
export OPENCLAW_VITEST_MAX_WORKERS=8
step targeted pnpm test src/agents/cli-runner/history-boundary.native-login.test.ts src/agents/cli-runner/prepare-native-history.test.ts src/agents/cli-runner/execute.native-history-owner.test.ts extensions/anthropic/cli-runtime.test.ts src/agents/cli-runner/execute-plugin.test.ts src/agents/cli-runner/cli-live-session-registry.test.ts src/agents/cli-credentials.test.ts src/plugin-sdk/provider-auth-claude-compat.test.ts src/agents/cli-runner/history-boundary.test.ts src/agents/cli-runner/history-boundary.incognito.test.ts
# E: owning lanes
step lane-cli-runner pnpm test src/agents/cli-runner/
step lane-anthropic pnpm test extensions/anthropic/
step lane-plugin-sdk-compat pnpm test src/plugin-sdk/provider-auth-claude-compat.test.ts
step lane-agents-sessions pnpm test src/agents/sessions/
uptime >> $S
step lane-config-sessions pnpm test src/config/sessions/
# F: changed-file gates
step diff-check git diff --check 372095136effb8dcaf2d9e59ace8bae193a6573b HEAD
step oxfmt-check node_modules/.bin/oxfmt --check $(git diff --name-only --diff-filter=AM 372095136effb8dcaf2d9e59ace8bae193a6573b HEAD -- '*.ts' '*.json')
step check-changed pnpm check:changed --base 372095136effb8dcaf2d9e59ace8bae193a6573b
step madge pnpm check:madge-import-cycles
echo "end $(date)" >> $S
