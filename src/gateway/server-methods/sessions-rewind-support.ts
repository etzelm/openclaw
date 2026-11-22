import path from "node:path";
import { ErrorCodes, errorShape } from "../../../packages/gateway-protocol/src/index.js";
import type {
  SessionBranchListResult,
  SessionBranchSwitchMutationResult,
  SessionMessageCutMutationResult,
} from "../../config/sessions/session-accessor.js";
import { parseInboundMediaUri } from "../../media/media-reference.js";
import { MEDIA_MAX_BYTES, readMediaBuffer } from "../../media/store.js";
import type { GatewayRequestHandlerOptions } from "./types.js";

export type MessageCutAction = "fork" | "rewind" | "switch";
export type MessageCutMutationResult =
  | SessionMessageCutMutationResult
  | SessionBranchSwitchMutationResult
  | { status: "conflict" };

// A message realistically carries a handful of images; a corrupt transcript must
// not turn rewind into a bulk media read.
const EDITOR_MEDIA_REF_LIMIT = 10;

export async function resolveEditorMediaAttachments(
  refs: Array<{ path: string; contentType: string }> | undefined,
): Promise<Array<{ mimeType: string; data: string }>> {
  if (!refs) {
    return [];
  }
  const seen = new Set<string>();
  const attachments: Array<{ mimeType: string; data: string }> = [];
  for (const ref of refs) {
    // Transcript references are untrusted hints; only an inbound id is read through the
    // media store (its traversal guards and byte cap stay authoritative), so
    // dedupe on that resolved id — path aliases must not repeat the same read.
    let id: string;
    try {
      id = parseInboundMediaUri(ref.path)?.id ?? path.basename(ref.path);
    } catch {
      // A corrupt URI is only a failed attachment hint, never a failed history cut.
      continue;
    }
    if (seen.has(id)) {
      continue;
    }
    seen.add(id);
    if (seen.size > EDITOR_MEDIA_REF_LIMIT) {
      break;
    }
    try {
      const media = await readMediaBuffer(id, "inbound", MEDIA_MAX_BYTES);
      attachments.push({ mimeType: ref.contentType, data: media.buffer.toString("base64") });
    } catch {
      // Skipped refs (missing file, oversized, guard rejection) never fail the cut.
    }
  }
  return attachments;
}

export function respondMessageCutError(
  result: Exclude<MessageCutMutationResult, { status: "created" }>,
  action: MessageCutAction,
  entryId: string,
  respond: GatewayRequestHandlerOptions["respond"],
): void {
  const actionLabel = action === "switch" ? "branch switch" : action;
  const message =
    result.status === "conflict"
      ? `Session changed; retry ${action}.`
      : result.status === "missing-session"
        ? "session not found"
        : result.status === "missing-entry"
          ? `${action === "switch" ? "branch" : "message"} entry not found: ${entryId}`
          : result.status === "not-branch-tip"
            ? `entry is not a branch tip: ${entryId}`
            : result.status === "already-active"
              ? `branch is already active: ${entryId}`
              : result.status === "not-user-message"
                ? `entry is not a user message: ${entryId}`
                : result.status === "off-active-path"
                  ? `message entry is not on the active path: ${entryId}`
                  : result.status === "unsupported-storage"
                    ? `session transcript storage does not support ${actionLabel}`
                    : `failed to ${actionLabel} session`;
  respond(
    false,
    undefined,
    errorShape(
      result.status === "failed" ? ErrorCodes.UNAVAILABLE : ErrorCodes.INVALID_REQUEST,
      message,
    ),
  );
}

export function respondBranchListError(
  result: Exclude<SessionBranchListResult, { status: "ok" }>,
  respond: GatewayRequestHandlerOptions["respond"],
): void {
  const message =
    result.status === "missing-session"
      ? "session not found"
      : result.status === "unsupported-storage"
        ? "session transcript storage does not support branch listing"
        : "failed to list session branches";
  respond(
    false,
    undefined,
    errorShape(
      result.status === "failed" ? ErrorCodes.UNAVAILABLE : ErrorCodes.INVALID_REQUEST,
      message,
    ),
  );
}
