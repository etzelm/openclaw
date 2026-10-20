#!/bin/bash
# Red/green at the round-3 tree (RED1-RED5, RED7-RED12; RED6 retired with its test file): each mutation applied alone to production code, the owning test
# file run alone (must FAIL), the file restored, the same test run again (must PASS), tree clean.
cd ~/work/pr-164796-merge4 || exit 1; export PATH=$HOME/homebrew/bin:$PATH
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
META=src/agents/cli-runner/history-boundary.native-login.test.ts
EXEC=src/agents/cli-runner/execute.native-history-owner.test.ts
PREP=src/agents/cli-runner/prepare-native-history.test.ts
RT=extensions/anthropic/cli-runtime.test.ts
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
COMPAT=src/plugin-sdk/provider-auth-claude-compat.test.ts
mutate "RED7 the credential-root split guard is removed" \
  src/plugin-sdk/provider-auth-claude-compat.ts \
  "    path.dirname(resolveClaudeCliCredentialsPath(homeDir, env)) !==
      resolveClaudeCliConfigDir(homeDir, env) ||
" \
  "" \
  $COMPAT
mutate "RED8 CLAUDE_CODE_OAUTH_TOKEN drops out of the non-native auth env list" \
  src/plugin-sdk/provider-auth-claude-compat.ts \
  "  \"CLAUDE_CODE_OAUTH_TOKEN\",
" \
  "" \
  $COMPAT
mutate "RED9 the profile request is sent without its timeout signal" \
  src/plugin-sdk/provider-auth-claude-compat.ts \
  "      signal: AbortSignal.timeout(CLAUDE_OAUTH_PROFILE_TIMEOUT_MS),
" \
  "      ...(AbortSignal.timeout(CLAUDE_OAUTH_PROFILE_TIMEOUT_MS) ? {} : {}),
" \
  $COMPAT
mutate "RED10 saved-history strictness keyed on a resumed session id" \
  src/agents/cli-runner/execute.ts \
  "const carriesSavedHistory = inputContext.cliHistoryWriter?.replaysHistory === true;" \
  "const carriesSavedHistory = inputContext.cliHistoryWriter?.replaysHistory === true && Boolean(cliSessionIdToUse);" \
  $EXEC
mutate "RED11 a native login lookup that throws escapes instead of meaning no owner" \
  src/agents/cli-runner/history-boundary.ts \
  "    try {
      return readAttestedNativeCliLoginOwner(provider, nativeEnv);
    } catch {
      return undefined;
    }
" \
  "    return readAttestedNativeCliLoginOwner(provider, nativeEnv);
" \
  $META
mutate "RED12 the throw is caught only at the coverage check (the first round-2 placement), not at the boundary checks" \
  src/agents/cli-runner/history-boundary.ts \
  "    try {
      return readAttestedNativeCliLoginOwner(provider, nativeEnv);
    } catch {
      return undefined;
    }
  };
  const nativeLoginMatches = () =>
    !nativeLoginOwner ||
    (!detached && !pendingAttestation && readNativeOwner() === nativeLoginOwner);
" \
  "    return readAttestedNativeCliLoginOwner(provider, nativeEnv);
  };
  const nativeLoginMatches = () => {
    try {
      return !nativeLoginOwner || (!detached && !pendingAttestation && readNativeOwner() === nativeLoginOwner);
    } catch {
      return false;
    }
  };
" \
  $META
REG=src/agents/cli-runner/cli-live-session-registry.test.ts
mutate "RED13 the re-applied warm-reuse fingerprint field is dropped (nativeLoginOwnerHash)" \
  src/agents/cli-runner/cli-live-session-registry.ts \
  "      nativeLoginOwnerHash: context.cliHistoryWriter?.bindsNativeLogin
        ? sha256Hex(context.cliHistoryWriter.authFingerprint)
        : undefined,
" \
  "" \
  $REG
echo "## GREEN (all six owning files, unmutated)"

pnpm test $META $EXEC $RT $PREP $COMPAT $REG 2>&1 | strip | grep -E "Test Files|Tests  "
git status --porcelain | wc -l
