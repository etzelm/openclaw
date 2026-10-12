#!/bin/bash
# Red/green at the pushed tree: each mutation applied alone to production code in a clone of the
# checkout, the owning test file run alone, the file restored, the clone verified clean.
cd ~/work/pr-164796-mut || exit 1
export OPENCLAW_VITEST_MAX_WORKERS=2
strip() { sed 's/\x1b\[[0-9;]*m//g'; }
mutate() { # label file python-old python-new test
  label=$1; file=$2; old=$3; new=$4; test=$5
  echo "## $label"
  python3 -I - "$file" "$old" "$new" <<'EOF'
import sys
p, old, new = sys.argv[1:4]
s = open(p).read()
assert s.count(old) == 1, (p, old, s.count(old))
open(p, "w").write(s.replace(old, new))
EOF
  git diff --stat -- "$file" | tail -1
  pnpm test "$test" 2>&1 | strip | grep -E "^ FAIL |^AssertionError|^TypeError|❯ src/.*test.ts:[0-9]|Tests  " | head -6
  git checkout -q -- "$file"
  [ -z "$(git status --porcelain)" ] && echo "(checkout clean)" || { echo "DIRTY"; git status --short; exit 1; }
}
META=src/agents/cli-runner/history-boundary.native-login-metadata.test.ts
EXEC=src/agents/cli-runner/execute.native-history-owner.test.ts
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
  "const carriesSavedHistory = historyWriter?.replaysHistory === true;" \
  "const carriesSavedHistory = Boolean(!cliSessionIdToUse && inputContext.openClawHistoryPrompt && historyWriter);" \
  $EXEC
RT=extensions/anthropic/cli-runtime.test.ts
mutate "RED4 the UserPromptSubmit response goes out on the stream check alone" \
  extensions/anthropic/cli.runtime.ts \
  "return carriesTurnContext(request, response) && !boundaryHolds(admittedTurn)
                ? {}
                : response;" \
  "return response;" \
  $RT
echo "## GREEN"
pnpm test $META $EXEC $RT 2>&1 | strip | grep -E "Test Files|Tests  "
