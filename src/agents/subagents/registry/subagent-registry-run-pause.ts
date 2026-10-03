import { truncateUtf16Safe } from "@openclaw/normalization-core/utf16-slice";
import type { OpenClawStateWorkerContext } from "../../../state/openclaw-state-worker-context.types.js";
import {
  clearDeliveryState,
  ensureCompletionState,
  resetRequesterSettleWakeRetry,
} from "./subagent-delivery-state.js";
import { SUBAGENT_ENDED_REASON_KILLED } from "./subagent-lifecycle-events.js";
import { shouldSuppressSubagentRecoverySessionEffects } from "./subagent-recovery-state.js";
import { mutateSubagentRuns, SubagentRegistryWriteError } from "./subagent-registry-persistence.js";
import type { SubagentRunRecord } from "./subagent-registry.types.js";

/** A yielded leaf that no continuation reached within this age of its pause is settled as expired. */
const YIELDED_WAIT_MAX_AGE_MS = 24 * 60 * 60_000;
const COLLECTOR_YIELD_ERROR =
  "Collector yielded without recording a result, and no continuation can resume a collector. Run it again and end its turn normally.";
const YIELDED_WAIT_EXPIRED_ERROR = `Subagent yielded and no continuation arrived within ${YIELDED_WAIT_MAX_AGE_MS / 3_600_000} hours of its pause.`;

type YieldedRunContinuation = { state: "continuable" } | { state: "unreachable"; error: string };

/**
 * Owns "can a continuation still resume this yielded run?" for a row where
 * `isYieldedSubagentRun` (execution observation) holds. Callers settle an unreachable run through the
 * completion owner instead of leaving it parked. The pause time is the `execution.endedAt` that
 * `markSubagentRunPausedAfterYield` records, so nothing extra is persisted. A run that still owes
 * a wake to unfinished children (`awaitsChildren`, or `wakeOnDescendantSettle`) stays continuable.
 */
export function resolveYieldedRunContinuation(
  entry: SubagentRunRecord,
  now: number,
  awaitsChildren: boolean,
): YieldedRunContinuation {
  // A collector result is read by an explicit wait, never delivered by a continuation, and a
  // frozen result is never replaced by an age expiry.
  if (entry.collect === true) {
    return entry.collectorCompletion === undefined
      ? { state: "unreachable", error: COLLECTOR_YIELD_ERROR }
      : { state: "continuable" };
  }
  const endedAt = entry.execution.endedAt;
  if (
    awaitsChildren ||
    entry.wakeOnDescendantSettle === true ||
    typeof endedAt !== "number" ||
    // A pause cannot predate its own row, so an earlier recorded end is not a pause time.
    now < Math.max(endedAt, entry.createdAt) + YIELDED_WAIT_MAX_AGE_MS
  ) {
    return { state: "continuable" };
  }
  return { state: "unreachable", error: YIELDED_WAIT_EXPIRED_ERROR };
}

/** Capture the accepted tool intent before the runtime publishes its yielded terminal. */
export async function markSubagentMessageWaitInRuns(params: {
  runId: string;
  sessionKey: string;
  acknowledgment?: string;
  runs: Map<string, SubagentRunRecord>;
  context: OpenClawStateWorkerContext;
  assertCurrent: () => void;
}): Promise<boolean> {
  const registered = await mutateSubagentRuns(
    [params.runId],
    (rows) => {
      const entry = rows.get(params.runId);
      if (
        !entry ||
        entry.childSessionKey !== params.sessionKey ||
        entry.expectsCompletionMessage !== true ||
        entry.collect ||
        entry.execution.status !== "running" ||
        entry.killIntent ||
        entry.killReconciliation ||
        entry.suppressCompletionDelivery
      ) {
        return { value: false };
      }
      if (entry.requesterSettleWake?.pauseNotice) {
        return { value: true };
      }
      const next = structuredClone(entry);
      next.requesterSettleWake = {
        ...resetRequesterSettleWakeRetry(entry.requesterSettleWake),
        batchRunIds: entry.requesterSettleWake?.batchRunIds ?? [entry.runId],
        pauseNotice: {
          acknowledgment: truncateUtf16Safe(
            params.acknowledgment?.trim() || "Paused awaiting continuation.",
            12_000,
          ),
        },
      };
      return { value: true, postimages: new Map([[entry.runId, next]]) };
    },
    { runs: params.runs, context: params.context, assertCurrent: params.assertCurrent },
  );
  try {
    params.assertCurrent();
  } catch (error) {
    throw new SubagentRegistryWriteError(
      registered ? "committed" : "not-committed",
      error,
      registered ? "published" : undefined,
    );
  }
  return registered;
}

export function markSubagentRunPausedAfterYield(params: {
  entry: SubagentRunRecord;
  startedAt?: number;
  endedAt?: number;
  now?: number;
}): boolean {
  const { entry } = params;
  if (
    entry.terminalOwner === "interrupted-recovery" ||
    shouldSuppressSubagentRecoverySessionEffects(entry) ||
    entry.endedReason === SUBAGENT_ENDED_REASON_KILLED ||
    entry.suppressAnnounceReason === "killed" ||
    (entry.cleanup === "delete" && Number.isFinite(entry.deleteCleanupDispatchedAt))
  ) {
    // agent.wait and lifecycle events can report an old yield after terminal
    // ownership settles. Reviving the row would expose a run whose session may
    // belong to a newer lifecycle or already be gone.
    return false;
  }
  let mutated = false;
  if (typeof params.startedAt === "number" && entry.execution.startedAt !== params.startedAt) {
    entry.execution = { ...entry.execution, startedAt: params.startedAt };
    if (typeof entry.sessionStartedAt !== "number") {
      entry.sessionStartedAt = params.startedAt;
    }
    mutated = true;
  }
  const endedAt = typeof params.endedAt === "number" ? params.endedAt : (params.now ?? Date.now());
  if (
    entry.execution.status !== "terminal" ||
    entry.execution.endedAt !== endedAt ||
    entry.execution.outcome !== undefined
  ) {
    entry.execution = { ...entry.execution, status: "terminal", endedAt };
    delete entry.execution.outcome;
    mutated = true;
  }
  if (entry.pauseReason !== "sessions_yield") {
    entry.pauseReason = "sessions_yield";
    mutated = true;
  }
  if (entry.archiveAtMs !== undefined) {
    delete entry.archiveAtMs;
    mutated = true;
  }
  if (entry.endedReason !== undefined) {
    entry.endedReason = undefined;
    mutated = true;
  }
  if (entry.cleanupHandled === true) {
    entry.cleanupHandled = false;
    mutated = true;
  }
  if (entry.cleanupCompletedAt !== undefined) {
    entry.cleanupCompletedAt = undefined;
    mutated = true;
  }
  if (entry.delivery !== undefined) {
    clearDeliveryState(entry);
    mutated = true;
  }
  const completion = ensureCompletionState(entry);
  if (completion.resultText !== undefined) {
    completion.resultText = undefined;
    completion.capturedAt = undefined;
    completion.terminalReply = undefined;
    mutated = true;
  }
  return mutated;
}
