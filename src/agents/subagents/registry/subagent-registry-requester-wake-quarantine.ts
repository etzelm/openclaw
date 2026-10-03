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
// cannot recover. Five identical rejections span about five minutes of backoff. Storage and
// transport failures never count: they keep retrying until the store recovers (#154252).
const REQUESTER_SETTLE_WAKE_QUARANTINE_AFTER_FAILURES = 5;

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
