import { ErrorCodes, errorShape } from "../../../packages/gateway-protocol/src/index.js";
import { isControlCommandMessage } from "../../auto-reply/command-detection.js";
import { isCommandEnabled } from "../../auto-reply/commands-registry-list.js";
import {
  hasSessionDirectives,
  parseInlineSessionDirectives,
} from "../../auto-reply/reply/directive-handling.parse.js";
import { FOREGROUND_BUSY_REPLY } from "../../auto-reply/reply/foreground-turn-policy.js";
import { replyRunRegistry } from "../../auto-reply/reply/reply-run-registry.js";
import type { SessionEntry } from "../../config/sessions/types.js";
import type { OpenClawConfig } from "../../config/types.openclaw.js";
import { matchPluginCommand } from "../../plugins/commands.js";
import { resolveOperatorRolePolicy } from "../operator-role-policy.js";
import type { NormalizedChatSendRequest } from "./chat-send-request.js";
import type { GatewayRequestContext, GatewayRequestHandlerOptions } from "./types.js";

type ActiveChatRun = { sessionKey?: string; sessionId?: string };

/** Thrown inside the session writer barrier; mapped to the busy reply. */
export const FOREGROUND_THREAD_BUSY = "foreground-thread-busy";

/**
 * Only an ordinary main-thread message becomes a persisted user turn. Side
 * questions and text the command owners recognize keep the channel-ingress
 * order, where command handling runs before the reply-admission busy check.
 * Ordinary text that only starts with "/" or "!" (a file path) is a user turn.
 */
export function isForegroundMainUserTurn(
  request: Pick<
    NormalizedChatSendRequest,
    "turnKind" | "rawMessage" | "suppressCommandInterpretation"
  >,
  cfg: OpenClawConfig,
): boolean {
  if (request.turnKind !== "main") {
    return false;
  }
  if (request.suppressCommandInterpretation) {
    return true;
  }
  const text = request.rawMessage.trim();
  const isCommand =
    isControlCommandMessage(text, cfg) ||
    matchPluginCommand(text) !== null ||
    (text.startsWith("!") && isCommandEnabled(cfg, "bash"));
  if (!isCommand) {
    return true;
  }
  // A session directive with a body ("/think high explain this") applies the
  // directive and then runs the body as a user turn, like any ordinary message.
  const directives = parseInlineSessionDirectives(text);
  return hasSessionDirectives(directives) && directives.cleaned.trim().length > 0;
}

export function isForegroundOnlyChatSend(
  entry: SessionEntry | undefined,
  client: GatewayRequestHandlerOptions["client"],
  cfg: OpenClawConfig,
): boolean {
  return (
    entry?.execution === "foreground-only" ||
    (client !== null && resolveOperatorRolePolicy(client, cfg)?.execution === "foreground-only")
  );
}

export function respondForegroundThreadBusy(respond: GatewayRequestHandlerOptions["respond"]) {
  respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, FOREGROUND_BUSY_REPLY));
}

/**
 * One bounded foreground turn per thread (RFC 0039, recommended pending
 * acceptance). A new chat.send on a busy foreground-only thread is refused
 * before work admission and before its user turn is written. A persisted user
 * turn without a reply is later folded into the next prompt as queued context,
 * which would quietly queue the rejected input after all.
 */
export function rejectBusyForegroundChatSend(params: {
  request: Pick<
    NormalizedChatSendRequest,
    "turnKind" | "rawMessage" | "suppressCommandInterpretation"
  >;
  cfg: OpenClawConfig;
  client: GatewayRequestHandlerOptions["client"];
  context: Pick<GatewayRequestContext, "chatAbortControllers"> &
    Partial<Pick<GatewayRequestContext, "chatQueuedTurns">>;
  entry: SessionEntry | undefined;
  sessionKey: string;
  activeRunScopeKey: string;
  respond: GatewayRequestHandlerOptions["respond"];
}): boolean {
  if (
    !isForegroundMainUserTurn(params.request, params.cfg) ||
    !isForegroundOnlyChatSend(params.entry, params.client, params.cfg)
  ) {
    return false;
  }
  const sessionId = params.entry?.sessionId;
  const ownsSession = (run: ActiveChatRun) =>
    run.sessionKey === params.sessionKey ||
    (sessionId !== undefined && run.sessionId === sessionId);
  const busy =
    replyRunRegistry.isActive(params.activeRunScopeKey) ||
    [params.context.chatAbortControllers, params.context.chatQueuedTurns].some((runs) =>
      [...(runs?.values() ?? [])].some(ownsSession),
    );
  if (!busy) {
    return false;
  }
  respondForegroundThreadBusy(params.respond);
  return true;
}
