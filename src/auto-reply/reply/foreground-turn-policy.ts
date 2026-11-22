import { MAX_TIMER_TIMEOUT_MS } from "@openclaw/normalization-core/number-coercion";
import { DEFAULT_AGENT_TIMEOUT_MS, resolveAgentTimeoutMs } from "../../agents/timeout.js";
import type { OpenClawConfig } from "../../config/types.openclaw.js";

/** Shown when a foreground-only thread receives a message while a turn is active. */
export const FOREGROUND_BUSY_REPLY =
  "This thread is still working on your previous request. Wait for it to finish or stop it, " +
  "then send your message again. It was not queued.";

const isUnlimited = (timeoutMs: number) => !(timeoutMs > 0) || timeoutMs >= MAX_TIMER_TIMEOUT_MS;

/**
 * RFC 0039 requires every foreground turn to have a finite deadline. The
 * operator's configured agent run timeout is the cap; an unlimited configured
 * timeout (0) falls back to the existing default agent timeout. A per-request
 * override can shorten a foreground turn but never extend it past the cap.
 * Approval and tool waits run inside the turn and cannot extend it.
 */
export function resolveForegroundTurnTimeoutMs(
  timeoutMs: number,
  foregroundOnly: boolean,
  cfg: OpenClawConfig | undefined,
): number {
  if (!foregroundOnly) {
    return timeoutMs;
  }
  const configured = resolveAgentTimeoutMs({ cfg });
  const cap = isUnlimited(configured) ? DEFAULT_AGENT_TIMEOUT_MS : configured;
  return isUnlimited(timeoutMs) ? cap : Math.min(timeoutMs, cap);
}
