import type { SubagentAnnounceDeliveryResult } from "../announce/subagent-announce-dispatch.js";
import {
  readRequesterSettleOwnerChangedMessage,
  REQUESTER_SETTLE_OWNER_CHANGED_MESSAGE,
} from "../completion/subagent-completion-mutation.kernel.js";
import type {
  PendingRequesterSettleWakeCommit,
  SubagentLifecycleWakeContext,
} from "./subagent-registry-lifecycle-context.js";
import { maskLifecycleIdentifier } from "./subagent-registry-lifecycle-log.js";
import type { SubagentRunRecord } from "./subagent-registry.types.js";

// Only the owner-changed rejection is a pure function of persisted rows, so repeating it
// cannot recover. Storage and transport failures never count: they keep retrying until the
// store recovers (#154252).
//
// Budget: the commit retry backoff is 30s doubling to a 120s cap (deferWakeCommit in
// subagent-registry-requester-wake-commit.ts), so the waits after rejections 1..4 are
// 30s, 60s, 120s and 120s. The fifth rejection, which quarantines, lands 330s (5.5 minutes)
// after the first; the controller-level test "spends the documented 330s between the first and
// fifth rejection" in subagent-completion-admission.quarantine.test.ts measures that lower
// bound with the real controller timer. It is the backoff alone: a sweeper resume (60s
// interval, subagent-registry-sweeper.ts) is not part of the measurement.
//
// The signature includes the first failing runId on purpose: a different failing member is
// a different obstacle, so a flapping cohort resets the count and is never quarantined
// for its churn alone. The count lives on the in-memory retry episode, so a Gateway restart
// starts a new episode: a row that still cannot settle spends five more attempts per boot
// and is then quarantined again. That keeps the bound without a schema change, and a
// quarantined row has no wake left to repeat after the restart (#154252).
const REQUESTER_SETTLE_WAKE_QUARANTINE_AFTER_FAILURES = 5;

/** Keeps the failed delivery's own error next to the quarantine reason in the stored row. */
export function appendDeliveryDetail(
  reason: string,
  outcome: Pick<SubagentAnnounceDeliveryResult, "error" | "reason">,
): string {
  const detail = outcome.error ?? outcome.reason;
  return detail ? `${reason}; last delivery error: ${detail}` : reason;
}

/**
 * Settle a non-delivered wake, quarantining it once the same owner-changed rejection has
 * repeated across consecutive attempts. Any other failure resets the count and rethrows,
 * so transient errors keep today's unbounded retry. A failing quarantine write rethrows
 * with the count intact and retries like any other storage failure.
 */
export async function settleOrQuarantineRequesterWake(
  context: SubagentLifecycleWakeContext,
  episode: PendingRequesterSettleWakeCommit,
  members: readonly SubagentRunRecord[],
  settle: () => Promise<boolean>,
  quarantine: (reason: string) => Promise<boolean>,
): Promise<boolean> {
  try {
    return await settle();
  } catch (error) {
    const signature = readRequesterSettleOwnerChangedMessage(error);
    // A paused yield cohort still owns unfinished requester work; it is never quarantined.
    if (!signature || members.some((member) => member.pauseReason === "sessions_yield")) {
      episode.ownerChangedSignature = undefined;
      episode.ownerChangedFailures = 0;
      throw error;
    }
    const failures =
      episode.ownerChangedSignature === signature ? (episode.ownerChangedFailures ?? 0) + 1 : 1;
    episode.ownerChangedSignature = signature;
    episode.ownerChangedFailures = failures;
    if (failures < REQUESTER_SETTLE_WAKE_QUARANTINE_AFTER_FAILURES) {
      throw error;
    }
    const committed = await quarantine(
      `requester settle wake quarantined after ${failures} identical settlement failures: ` +
        REQUESTER_SETTLE_OWNER_CHANGED_MESSAGE,
    );
    if (committed) {
      context.options.warn("requester settle wake quarantined", {
        signature: REQUESTER_SETTLE_OWNER_CHANGED_MESSAGE,
        failures,
        runIds: members.map((member) => maskLifecycleIdentifier(member.runId, "run")),
      });
    }
    return committed;
  }
}
