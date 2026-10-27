import type { GatewaySessionRow } from "../../api/types.ts";
import type { ApplicationContext } from "../../app/context.ts";
import { readSessionMethodAccess } from "../session-method-access.ts";
import { resolveUiSessionRowAgentId } from "./session-key.ts";

/** The failed session to acknowledge; callers decide that its failure is still an alert. */
type SessionFailureTarget = Pick<GatewaySessionRow, "key"> &
  Partial<Pick<GatewaySessionRow, "agentId" | "sessionId" | "markedUnreadAt" | "sharingRole">>;

/** Viewers and callers without patch access keep the alert; it still clears when they open it. */
export function canDismissSessionFailure(
  context: Pick<ApplicationContext, "gateway">,
  target: SessionFailureTarget,
  fallbackAgentId = "main",
): boolean {
  return (
    target.sharingRole !== "viewer" &&
    readSessionMethodAccess(context.gateway.snapshot, {
      method: "sessions.patch",
      params: {
        key: target.key,
        unread: false,
        agentId: resolveUiSessionRowAgentId(target, fallbackAgentId),
      },
      sessionScope: true,
      session: target,
    }).allowed
  );
}

/**
 * Dismissing a failure writes the same Gateway read receipt that opening the session does,
 * so every surface and device hides it and a later failure of the same session shows again.
 * The alert stays until the Gateway row reports the read; the capability publishes failures.
 */
export async function dismissSessionFailures(
  context: Pick<ApplicationContext, "gateway" | "sessions">,
  targets: readonly SessionFailureTarget[],
  fallbackAgentId = "main",
): Promise<void> {
  await Promise.all(
    targets
      .filter((target) => canDismissSessionFailure(context, target, fallbackAgentId))
      .map((target) =>
        context.sessions
          .patch(
            target.key,
            { unread: false },
            {
              agentId: resolveUiSessionRowAgentId(target, fallbackAgentId),
              expectedMarkedUnreadAt: target.markedUnreadAt ?? null,
              ...(target.sessionId ? { expectedSessionId: target.sessionId } : {}),
            },
          )
          .catch(() => undefined),
      ),
  );
}
