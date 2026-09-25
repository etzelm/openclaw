import type {
  PendingRequesterSettleWakeCommit,
  SubagentLifecycleWakeContext,
} from "./subagent-registry-lifecycle-context.js";
import { maskLifecycleIdentifier } from "./subagent-registry-lifecycle-delivery.js";
import type { SubagentRunRecord } from "./subagent-registry.types.js";

/**
 * Retries allowed for one settlement write before it stops.
 *
 * A settlement write that keeps failing cannot durably record its own give-up,
 * because the durable write is the thing failing. So exhaustion stops the retry
 * instead of writing an outcome: the wake stays on its row, no captured result
 * is discarded, and no sibling obligation is cleared.
 */
const REQUESTER_SETTLE_WAKE_COMMIT_MAX_FAILURES = 5;

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
  if (pending.failures >= REQUESTER_SETTLE_WAKE_COMMIT_MAX_FAILURES) {
    pending.exhausted = true;
    // A deadline already in the past leaves no retry timer armed, and the
    // retained pending keeps the lifecycle owner short-circuited here. A fresh
    // attempt needs a genuine row change, which drops this pending, or a restart.
    pending.nextAttemptAt = 0;
    context.options.warn("requester settle wake commit abandoned after repeated failures", {
      failures: pending.failures,
      runIds: pending.entries.map((entry) => maskLifecycleIdentifier(entry.runId, "run")),
    });
    return;
  }
  pending.nextAttemptAt =
    Date.now() + Math.min(120_000, 30_000 * 2 ** Math.min(pending.failures - 1, 2));
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
  // An abandoned commit keeps its custody but never retries again.
  if (pending.exhausted || pending.nextAttemptAt > Date.now()) {
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
