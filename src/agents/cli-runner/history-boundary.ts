import { normalizeProviderId } from "@openclaw/model-catalog-core/provider-id";
import {
  isKnownCliHistoryBoundary,
  runWithCliHistoryWriter,
  type CliExecutionHistoryWriter,
  type CliHistoryBoundary,
} from "../../config/sessions/cli-history-boundary.js";
import {
  loadSessionEntryReadOnly,
  patchSessionEntryCore,
  readSessionTranscriptWatermark,
  resolveSessionTranscriptDatabasePath,
  validateSessionTranscriptContextAdmission,
  waitForSessionTranscriptProjection,
} from "../../config/sessions/session-accessor.js";
import { resolveSessionTranscriptReadFence } from "../../config/sessions/session-transcript-read-fence.js";
import { assertOwnedTranscriptWriteCommit } from "../../config/sessions/transcript-write-context.js";
import type { InternalSessionEntry } from "../../config/sessions/types.js";
import { hasLiveAgentRunContext } from "../../infra/agent-run-registry.js";
import { bindAgentRunTerminalWriteContext } from "../../infra/agent-run-terminal-writes.js";
import { sha256Hex } from "../../infra/crypto-digest.js";
import {
  getAdmittedRunDelegatedAuthority,
  resolveAdmittedRunActiveAssertion,
} from "../admitted-run-context.js";
import type { AuthProfileCredential } from "../auth-profiles/types.js";
import { resolveNativeCliLoginOwner } from "../cli-credentials.js";
import { buildSessionContext, SessionManager } from "../sessions/session-manager.js";
import { resolveCliChildEnv } from "./execution-env.js";
import { createCliRunCurrentAssertion, resolveCliExecutionTarget } from "./execution-target.js";
import type { PreparedCliRunContext } from "./types.js";

/**
 * History belongs to the local transcript, not the latest native handle. Cover only
 * a proven-empty start or the contiguous events of the previously admitted CLI run.
 * An account transition, old-runtime write, import or unknown legacy prefix stays
 * unknown until an explicitly empty context starts a new history boundary.
 */
export async function prepareCliHistoryBoundary(
  params: PreparedCliRunContext["params"],
  credential: AuthProfileCredential | undefined,
  /**
   * The prepared backend the CLI child will run from. A native login owner is resolved only
   * from the environment it yields (resolveCliChildEnv, the same function execution spawns
   * with); without it no owner can be established and history is refused.
   */
  preparedBackend?: Parameters<typeof resolveCliChildEnv>[0],
): Promise<CliExecutionHistoryWriter | undefined> {
  const source = params.sessionTarget;
  if (
    params.sessionManager ||
    !source ||
    source.sessionId !== params.sessionId ||
    (params.sessionKey !== undefined && params.sessionKey !== source.sessionKey) ||
    !resolveAdmittedRunActiveAssertion(params.admittedRunContext, params.abortSignal)
  ) {
    return undefined;
  }
  const target = { ...source, storePath: resolveSessionTranscriptDatabasePath(source) };
  const assertCurrent = createCliRunCurrentAssertion(params);
  await waitForSessionTranscriptProjection(target, params.abortSignal);
  assertCurrent();
  const snapshot: InternalSessionEntry | undefined = loadSessionEntryReadOnly(target);
  if (!snapshot || snapshot.sessionId !== target.sessionId) {
    return undefined;
  }
  const watermark = readSessionTranscriptWatermark(target);
  const admission = resolveSessionTranscriptReadFence(target);
  validateSessionTranscriptContextAdmission(target, admission);
  const priorMaxSeq = admission ? admission.rawSeq - 1 : watermark.maxSeq;
  const currentUserIsLast = !admission || watermark.maxSeq === admission.rawSeq;
  const stored = snapshot.cliHistoryBoundary;
  const childEnv =
    !credential && preparedBackend ? resolveCliChildEnv(preparedBackend).env : undefined;
  const provider = normalizeProviderId(params.provider);
  // A forwarded credential decides which account runs. Without one, the CLI runs under the
  // native login its own environment selects, unless it is node-placed and runs under the
  // node's login instead. The Gateway process environment is never the identity source.
  const nativeLoginOwner =
    credential ||
    !childEnv ||
    resolveCliExecutionTarget({ params, backendId: provider }).kind === "node"
      ? undefined
      : resolveNativeCliLoginOwner(provider, childEnv);
  // Native reuse epochs intentionally tolerate identity-less OAuth and stable
  // SecretRefs. History cannot: use the resolved static credential or a named
  // OAuth account, never a profile name, reference, or opaque CLI login alone.
  const owner =
    credential?.type === "oauth"
      ? credential.accountId?.trim() || credential.email?.trim()
        ? [
            "oauth",
            credential.provider,
            credential.accountId,
            credential.email,
            credential.clientId,
            credential.enterpriseUrl,
            credential.projectId,
          ]
        : undefined
      : credential?.type === "api_key" && credential.key?.trim()
        ? ["api_key", credential.provider, credential.key]
        : credential?.type === "token" && credential.token?.trim()
          ? ["token", credential.provider, credential.token]
          : nativeLoginOwner
            ? ["native-login", nativeLoginOwner]
            : undefined;
  const fingerprint = owner
    ? sha256Hex(JSON.stringify(["cli-history-v1", provider, owner]))
    : undefined;
  const writerRunId = params.expectedWriterRunId ?? params.runId;
  let allowed = Boolean(
    fingerprint &&
    currentUserIsLast &&
    params.cliSessionBinding?.forceReuse !== true &&
    isKnownCliHistoryBoundary(stored) &&
    stored.sessionId === target.sessionId &&
    stored.authFingerprint === fingerprint &&
    stored.generation === watermark.generation &&
    (stored.maxSeq === priorMaxSeq ||
      (admission && stored.writerRunId === writerRunId && stored.maxSeq === watermark.maxSeq)),
  );
  if (
    !allowed &&
    fingerprint &&
    currentUserIsLast &&
    !params.cliSessionId &&
    !params.cliSessionBinding
  ) {
    let truncated = false;
    const branch = (
      await SessionManager.openBoundedAsync(target, {
        signal: params.abortSignal,
        maxBytes: 1024 * 1024,
        maxEvents: 100,
        onTruncated: () => {
          truncated = true;
        },
      })
    ).getBranch();
    assertCurrent();
    // Bookkeeping is not a conversation. Retained reset rows, summaries, custom
    // context, missing anchors and bounded cuts must never look like a fresh start.
    allowed = !truncated && buildSessionContext(branch).messages.length === 0;
  }
  allowed &&= watermark.maxSeq === null || typeof watermark.generation === "string";
  if (!allowed && !stored) {
    return undefined;
  }
  const boundary: CliHistoryBoundary =
    allowed && fingerprint
      ? {
          version: 1,
          sessionId: target.sessionId,
          state: "known",
          authFingerprint: fingerprint,
          generation: watermark.generation,
          maxSeq: watermark.maxSeq,
          writerRunId,
        }
      : { version: 1, sessionId: target.sessionId, state: "unknown" };
  const committed = await patchSessionEntryCore(
    target,
    (current: InternalSessionEntry) => {
      if (
        current.sessionId !== target.sessionId ||
        current.lifecycleRevision !== snapshot.lifecycleRevision ||
        current.activeWriterRunId !== snapshot.activeWriterRunId ||
        (params.expectedLifecycleRevision !== undefined &&
          current.lifecycleRevision !== params.expectedLifecycleRevision)
      ) {
        throw new Error("CLI history owner changed before preparation");
      }
      return { activeWriterRunId: writerRunId, cliHistoryBoundary: boundary };
    },
    {
      preserveActivity: true,
      skipMaintenance: true,
      onCommitted: (entry) => {
        // Binding settlement retains this detached row; publish only our committed writer adoption.
        const callerEntry: InternalSessionEntry | undefined = params.sessionEntry;
        if (
          callerEntry?.sessionId === snapshot.sessionId &&
          callerEntry.lifecycleRevision === snapshot.lifecycleRevision &&
          callerEntry.activeWriterRunId === snapshot.activeWriterRunId
        ) {
          callerEntry.activeWriterRunId = entry.activeWriterRunId;
        }
      },
      assertCommitAllowed: () => {
        assertCurrent();
        // Planning may yield. Recheck foreign liveness at commit, then adopt the
        // CLI claim so a later reuse of the dead run ID remains a visible takeover.
        if (
          snapshot.activeWriterRunId !== undefined &&
          snapshot.activeWriterRunId !== writerRunId &&
          hasLiveAgentRunContext(snapshot.activeWriterRunId)
        ) {
          throw new Error("CLI history owner changed before preparation");
        }
        assertOwnedTranscriptWriteCommit(target);
        validateSessionTranscriptContextAdmission(target, admission);
        const fresh = readSessionTranscriptWatermark(target);
        if (fresh.generation !== watermark.generation || fresh.maxSeq !== watermark.maxSeq) {
          throw new Error("CLI history changed before preparation");
        }
      },
    },
  );
  if (!committed || !allowed || boundary.state !== "known") {
    return undefined;
  }
  const assertActive = resolveAdmittedRunActiveAssertion(params.admittedRunContext);
  const assertWriterCurrent = () => {
    params.assertCurrent?.();
    if (!assertActive) {
      throw new Error("CLI history writer is no longer active");
    }
    assertActive();
  };
  // The fingerprint proves only the login observed at preparation. Every authority check
  // resolves it again, uncached, from the environment the child runs under: execution
  // rebinds this to the exact environment it spawns with.
  let nativeEnv: NodeJS.ProcessEnv | undefined = childEnv;
  const assertNativeLoginCurrent = (message = "CLI history authority changed before execution") => {
    if (
      nativeLoginOwner &&
      (!nativeEnv || resolveNativeCliLoginOwner(provider, nativeEnv) !== nativeLoginOwner)
    ) {
      throw new Error(message);
    }
  };
  const assertProofCurrent = () => {
    const current: InternalSessionEntry | undefined = loadSessionEntryReadOnly(target);
    const proof = current?.cliHistoryBoundary;
    const tip = readSessionTranscriptWatermark(target);
    if (
      !current ||
      current.sessionId !== target.sessionId ||
      current.lifecycleRevision !== snapshot.lifecycleRevision ||
      current.activeWriterRunId !== writerRunId ||
      !isKnownCliHistoryBoundary(proof) ||
      proof.sessionId !== target.sessionId ||
      proof.writerRunId !== writerRunId ||
      proof.authFingerprint !== boundary.authFingerprint ||
      proof.generation !== tip.generation ||
      proof.maxSeq !== tip.maxSeq
    ) {
      throw new Error("CLI history authority changed before execution");
    }
  };
  const writer: CliExecutionHistoryWriter = {
    target: { ...target },
    runId: writerRunId,
    authFingerprint: boundary.authFingerprint,
    lifecycleRevision: snapshot.lifecycleRevision,
    bindsNativeLogin: nativeLoginOwner !== undefined,
    // Also guards every coverage commit, so a turn run under a switched login is never
    // recorded as covered by the owner observed at preparation.
    assertCurrent: () => {
      assertWriterCurrent();
      assertNativeLoginCurrent();
    },
    assertReadable: () => {
      assertWriterCurrent();
      assertNativeLoginCurrent();
      assertProofCurrent();
    },
    // Output events arrive after the prompt was delivered. They keep the run and recovery
    // proof checks but not the native login lookup, which can cost a subprocess per call.
    assertStream: (recovering) => {
      assertWriterCurrent();
      if (recovering) {
        assertProofCurrent();
      }
    },
    bindExecutionEnv: (env) => {
      nativeEnv = env;
      assertNativeLoginCurrent(
        "CLI history authority changed before execution: the spawn environment selects a different Claude login than the one recorded at preparation",
      );
    },
  };
  const authority = getAdmittedRunDelegatedAuthority(params.admittedRunContext);
  if (!authority) {
    throw new Error("CLI history writer is no longer active");
  }
  bindAgentRunTerminalWriteContext(authority, {
    run: (write) => runWithCliHistoryWriter(writer, write),
  });
  return writer;
}
