import type {
  PendingRequesterSettleWakeCommit,
  SubagentLifecycleWakeContext,
} from "./subagent-registry-lifecycle-context.js";
import { maskLifecycleIdentifier } from "./subagent-registry-lifecycle-delivery.js";
import type { SubagentRunRecord } from "./subagent-registry.types.js";

/**
 * Consecutive failures after which one settlement write counts as sustained.
 *
 * Reaching it changes cadence and logging only. The obligation is never
 * abandoned: the durable write that cannot succeed now can succeed once storage
 * recovers, and the requester stays unsettled until it does.
 */
const REQUESTER_SETTLE_WAKE_COMMIT_SUSTAINED_FAILURES = 5;

/**
 * Longest gap between retries of one settlement write.
 *
 * The original ceiling was 120s, so a write that could never succeed was
 * reattempted, and logged, every two minutes for the life of the process.
 */
const REQUESTER_SETTLE_WAKE_COMMIT_MAX_BACKOFF_MS = 1_800_000;

function clearPendingWakeCommit(
  context: SubagentLifecycleWakeContext,
  pending: PendingRequesterSettleWakeCommit,
): void {
  for (const entry of pending.entries) {
    if (context.pendingRequesterSettleWakeCommits.get(entry) === pending) {
      context.pendingRequesterSettleWakeCommits.delete(entry);
    }
  }
}

export function getPendingWakeCommit(
  context: SubagentLifecycleWakeContext,
  entry: SubagentRunRecord,
): PendingRequesterSettleWakeCommit | undefined {
  const pending = context.pendingRequesterSettleWakeCommits.get(entry);
  if (pending && !pending.isCurrent(entry)) {
    // A changed row relinquishes only its own obligation. Surviving siblings
    // must keep the known outcome or replay budget ahead of transport.
    context.pendingRequesterSettleWakeCommits.delete(entry);
    return undefined;
  }
  return pending;
}

function deferWakeCommit(
  context: SubagentLifecycleWakeContext,
  pending: PendingRequesterSettleWakeCommit,
): void {
  pending.failures += 1;
  if (
    pending.failures >= REQUESTER_SETTLE_WAKE_COMMIT_SUSTAINED_FAILURES &&
    !pending.sustainedFailureReported
  ) {
    // One report per episode: this warn does not repeat every attempt. The
    // original flood came from per-attempt logging at the commit call site
    // this diff does not touch; raising the backoff ceiling from 120s to
    // 30min throttles that logging roughly 15x rather than eliminating it.
    pending.sustainedFailureReported = true;
    context.options.warn("requester settle wake commit still failing; retries continue", {
      failures: pending.failures,
      maxBackoffMs: REQUESTER_SETTLE_WAKE_COMMIT_MAX_BACKOFF_MS,
      runIds: pending.entries.map((entry) => maskLifecycleIdentifier(entry.runId, "run")),
    });
  }
  // Always a future deadline. The lifecycle owner arms its retry timer from
  // this value and skips any deadline that is not ahead of now, so a deadline
  // in the past would strand the pending wake until restart.
  pending.nextAttemptAt =
    Date.now() +
    Math.min(REQUESTER_SETTLE_WAKE_COMMIT_MAX_BACKOFF_MS, 30_000 * 2 ** (pending.failures - 1));
}

// Persistence failure cannot erase a transport result or its replay budget. Keep
// that exact operation in the lifecycle owner, ahead of every later transport.
export function commitRequesterWake(
  context: SubagentLifecycleWakeContext,
  entries: readonly SubagentRunRecord[],
  generation: number | undefined,
  commit: (entries: readonly SubagentRunRecord[]) => boolean,
  retainOnFailure: boolean,
): void {
  const owners = entries.map((entry) => ({
    entry,
    runId: entry.runId,
    createdAt: entry.createdAt,
    taskRunId: entry.taskRunId,
    wake: entry.requesterSettleWake,
    wakeJson: JSON.stringify(entry.requesterSettleWake),
    deliveryGeneration: entry.delivery?.generation,
    generation: entry.generation,
    execution: entry.execution,
    cancellation: entry.killReconciliation,
    suppressed: entry.suppressCompletionDelivery,
  }));
  const pending: PendingRequesterSettleWakeCommit = {
    entries: [...entries],
    commit,
    failures: 0,
    nextAttemptAt: 0,
    isCurrent: (current) =>
      owners.some(
        ({
          entry,
          runId,
          createdAt,
          taskRunId,
          wake,
          wakeJson,
          deliveryGeneration,
          generation: runGeneration,
          execution,
          cancellation,
          suppressed,
        }) => {
          if (
            entry !== current ||
            context.options.runs.get(runId) !== entry ||
            entry.runId !== runId ||
            entry.createdAt !== createdAt ||
            entry.taskRunId !== taskRunId ||
            entry.generation !== runGeneration ||
            !entry.requesterSettleWake ||
            entry.requesterSettleWake.rearmGeneration !== generation ||
            context.newerGenerationOwnsSession(entry)
          ) {
            return false;
          }
          if (
            entry.requesterSettleWake === wake &&
            entry.execution === execution &&
            entry.killReconciliation === cancellation &&
            entry.suppressCompletionDelivery === suppressed
          ) {
            return true;
          }
          // Independent blocking republishes the row but does not consume its wake.
          // Keep that exact closed member in settlement: the store must validate its
          // durable state and consume the obsolete wake without rewriting its failure.
          return (
            entry.execution.status === "terminal" &&
            entry.pauseReason !== "sessions_yield" &&
            entry.suppressCompletionDelivery === true &&
            entry.delivery?.status === "failed" &&
            entry.delivery.generation === deliveryGeneration &&
            JSON.stringify(entry.requesterSettleWake) === wakeJson
          );
        },
      ),
  };
  const retain = () => {
    if (!retainOnFailure) {
      return;
    }
    deferWakeCommit(context, pending);
    for (const entry of entries) {
      if (pending.isCurrent(entry)) {
        context.pendingRequesterSettleWakeCommits.set(entry, pending);
      }
    }
  };
  try {
    // A temporarily closed Gateway can defer settlement without invalidating
    // already observed delivery. Only changed row ownership drops its fence.
    if (!commit(entries)) {
      retain();
    }
  } catch (error) {
    retain();
    throw error;
  }
}

export function retryPendingWakeCommit(
  context: SubagentLifecycleWakeContext,
  pending: PendingRequesterSettleWakeCommit,
): void {
  if (pending.nextAttemptAt > Date.now()) {
    return;
  }
  try {
    const members = pending.entries.filter(
      (member) => getPendingWakeCommit(context, member) === pending,
    );
    if (pending.commit(members)) {
      clearPendingWakeCommit(context, pending);
    } else {
      deferWakeCommit(context, pending);
    }
  } catch (error) {
    deferWakeCommit(context, pending);
    throw error;
  }
}
