import { isRestartRecoveryTerminalRunListSaturated } from "../../config/sessions/restart-recovery-state.js";
import { findTranscriptEvent } from "../../config/sessions/session-transcript-match.js";
import type { SessionEntry } from "../../config/sessions/types.js";

/** One notice per stopped foreground request; the key is also its durable receipt. */
export function foregroundRestartStopNoticeKey(sourceRunId: string): string {
  return `foreground-restart:${sourceRunId}:stopped`;
}

export type ForegroundRestartStopReceipt = "found" | "absent" | "unavailable";

/**
 * The bounded terminal run-id list can evict a stopped foreground request. While
 * its exact scoped notice remains in the transcript, same-ID admission must still
 * recognize the stopped run. A failed lookup is unavailable, never proof of absence.
 */
export async function findForegroundRestartStopReceipt(params: {
  entry: SessionEntry | undefined;
  clientRunId: string;
  sessionKey: string;
  storePath: string;
  find?: typeof findTranscriptEvent;
}): Promise<ForegroundRestartStopReceipt> {
  const { entry } = params;
  // Until the bounded terminal list is full, absence from it is conclusive and
  // a fresh message never pays for (or fails on) a transcript lookup.
  if (
    entry?.execution !== "foreground-only" ||
    !entry.sessionId ||
    !isRestartRecoveryTerminalRunListSaturated(entry)
  ) {
    return "absent";
  }
  try {
    const found = await (params.find ?? findTranscriptEvent)(
      { sessionKey: params.sessionKey, sessionId: entry.sessionId, storePath: params.storePath },
      {
        kind: "idempotency",
        key: foregroundRestartStopNoticeKey(params.clientRunId),
        assistant: true,
      },
    );
    return found ? "found" : "absent";
  } catch {
    return "unavailable";
  }
}
