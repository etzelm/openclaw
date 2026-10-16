#!/bin/bash
# Red/green at the final tree: each mutation applied alone to production code, the owning test
# file run alone (must FAIL), the file restored, the same test run again (must PASS), tree clean.
cd ~/work/pr164796 || exit 1
export OPENCLAW_VITEST_MAX_WORKERS=2
strip() { sed 's/\x1b\[[0-9;]*m//g'; }
mutate() { # label file old new test
  label=$1; file=$2; old=$3; new=$4; test=$5
  echo "## $label"
  python3 -I - "$file" "$old" "$new" <<'PY'
import sys
p, old, new = sys.argv[1:4]
s = open(p).read()
assert s.count(old) == 1, (p, old, s.count(old))
open(p, "w").write(s.replace(old, new))
PY
  [ $? -eq 0 ] || { echo "MUTATION DID NOT APPLY"; return; }
  git diff --stat -- "$file" | tail -1
  echo "-- mutated:"
  pnpm test "$test" 2>&1 | strip | grep -E "^ FAIL |^AssertionError|^TypeError|❯ (src|extensions)/.*test.ts:[0-9]|Tests  " | head -6
  git checkout -q -- "$file"
  echo "-- restored:"
  pnpm test "$test" 2>&1 | strip | grep -E "^ FAIL |Test Files|Tests  "
  [ -z "$(git status --porcelain)" ] && echo "(checkout clean)" || { echo "DIRTY"; git status --short; exit 1; }
}
META=src/agents/cli-runner/history-boundary.native-login-metadata.test.ts
EXEC=src/agents/cli-runner/execute.native-history-owner.test.ts
PREP=src/agents/cli-runner/prepare-native-history.test.ts
RT=extensions/anthropic/cli-runtime.private-input.test.ts
mutate "RED1 host sends SessionManager writer facts without the owner-check request" \
  src/agents/sessions/session-manager-metadata-command.ts \
  "cliWriter: cliWriter && cliHistoryWriterFacts(cliWriter)," \
  "cliWriter: cliWriter && { runId: cliWriter.runId, authFingerprint: cliWriter.authFingerprint, lifecycleRevision: cliWriter.lifecycleRevision }," \
  $META
mutate "RED2 metadata host never answers the owner probe" \
  src/agents/sessions/session-manager-metadata-runtime.ts \
  "answerCliHistoryOwnerProbe(cliHistoryOwnerProbe, cliWriter);" \
  "void cliHistoryOwnerProbe;" \
  $META
mutate "RED3 execute.ts back to the earlier rule: only a fresh recovery prompt is strict" \
  src/agents/cli-runner/execute.ts \
  "const carriesSavedHistory = inputContext.cliHistoryWriter?.replaysHistory === true;" \
  "const carriesSavedHistory = Boolean(!cliSessionIdToUse && inputContext.openClawHistoryPrompt && inputContext.cliHistoryWriter);" \
  $EXEC
mutate "RED4 the UserPromptSubmit response goes out on the stream check alone" \
  extensions/anthropic/cli.runtime.ts \
  "return carriesTurnContext(request, response) && !privateInputHolds(admittedTurn)
                  ? {}
                  : response;" \
  "return response;" \
  $RT
mutate "RED5 the native login is attested without the operator's opt-in" \
  src/agents/cli-runner/history-boundary.ts \
  "    !isNativeCliLoginAttestationEnabled(provider, params.config) ||
" \
  "" \
  $PREP
echo "## GREEN (all five owning files, unmutated)"
pnpm test $META $EXEC $RT $PREP 2>&1 | strip | grep -E "Test Files|Tests  "
git status --porcelain | wc -l
