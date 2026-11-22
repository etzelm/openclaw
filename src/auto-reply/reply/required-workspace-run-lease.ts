import {
  assertRequiredSessionWorktreeCheckout,
  REQUIRED_WORKTREE_UNAVAILABLE,
} from "../../agents/worktrees/required-session-binding.js";
import {
  acquireWorktreeRunLease,
  resolveWorktreeIdForPath,
} from "../../agents/worktrees/run-lease.js";
import type { SessionEntry } from "../../config/sessions.js";
import type { OpenClawConfig } from "../../config/types.openclaw.js";

export type RequiredWorkspaceReplyLease = { release: () => Promise<void> };

/** Release custody only after the admission owner has closed the run. */
export async function closeBeforeReleasingRequiredWorkspace(
  admission: { close: () => Promise<void> },
  lease: RequiredWorkspaceReplyLease | undefined,
): Promise<void> {
  try {
    await admission.close();
  } finally {
    await lease?.release();
  }
}

/** A vanished checkout is a custody denial with the user-facing explanation, not a raw errno. */
async function resolveRequiredWorktreeId(
  params: Parameters<typeof resolveWorktreeIdForPath>[0],
): Promise<string> {
  let worktreeId: string | undefined;
  try {
    worktreeId = await resolveWorktreeIdForPath(params);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | undefined)?.code;
    if (code === "ENOENT" || code === "ENOTDIR") {
      throw new Error(REQUIRED_WORKTREE_UNAVAILABLE, { cause: error });
    }
    throw error;
  }
  if (!worktreeId) {
    throw new Error(REQUIRED_WORKTREE_UNAVAILABLE);
  }
  return worktreeId;
}

/**
 * The shared reply execution owner (normal and queued turns) takes custody
 * before any attempt prepares the workspace or starts a process in the checkout.
 * Sessions without the requirement return synchronously so run ownership and
 * lifecycle registration keep their existing ordering.
 */
export function acquireReplyTurnRequiredWorkspaceLease(turn: {
  sessionKey?: string;
  activeSessionStore?: Record<string, SessionEntry>;
  getActiveSessionEntry: () => SessionEntry | undefined;
  followupRun: {
    run: { cwd?: string; sessionRoot?: string; config: OpenClawConfig };
    operatorAuthority?: { assertCurrent: () => void };
  };
}): Promise<RequiredWorkspaceReplyLease | undefined> | undefined {
  const entry = turn.activeSessionStore?.[turn.sessionKey ?? ""] ?? turn.getActiveSessionEntry();
  if (!entry?.requiredWorkspace) {
    return undefined;
  }
  return acquireRequiredWorkspaceReplyLease({
    entry,
    sessionKey: turn.sessionKey,
    cfg: turn.followupRun.run.config,
    candidatePaths: [turn.followupRun.run.cwd, turn.followupRun.run.sessionRoot],
    assertCurrent: () => turn.followupRun.operatorAuthority?.assertCurrent(),
  });
}

/** Pre-execution writes (inbound media staging) must also stay inside the exact checkout. */
export async function assertRequiredWorkspaceReplyPaths(params: {
  entry: SessionEntry | undefined;
  sessionKey: string | undefined;
  cfg: OpenClawConfig;
  candidatePaths: Array<string | undefined>;
  env?: NodeJS.ProcessEnv;
}): Promise<void> {
  if (!params.entry?.requiredWorkspace) {
    return;
  }
  await resolveRequiredWorktreeId({
    sessionEntry: params.entry,
    sessionKey: params.sessionKey,
    cfg: params.cfg,
    candidatePaths: params.candidatePaths,
    env: params.env,
  });
}

/**
 * Reply execution owns the same custody contract as command preparation: a
 * session with a recorded required workspace runs only inside its exact managed
 * checkout, under a native run lease, before any filesystem or process effect.
 * Sessions without the requirement keep their existing lifetime and paths.
 */
export async function acquireRequiredWorkspaceReplyLease(params: {
  entry: SessionEntry | undefined;
  sessionKey: string | undefined;
  cfg: OpenClawConfig;
  candidatePaths: Array<string | undefined>;
  assertCurrent?: () => void;
  env?: NodeJS.ProcessEnv;
}): Promise<RequiredWorkspaceReplyLease | undefined> {
  const { entry } = params;
  if (!entry?.requiredWorkspace) {
    return undefined;
  }
  const assertCurrent = params.assertCurrent ?? (() => {});
  // Validates binding, lineage, and that every candidate path stays inside the
  // recorded checkout. A missing checkout fails realpath instead of being recreated.
  const worktreeId = await resolveRequiredWorktreeId({
    sessionEntry: entry,
    sessionKey: params.sessionKey,
    cfg: params.cfg,
    assertCurrent,
    candidatePaths: params.candidatePaths,
    env: params.env,
  });
  return await acquireWorktreeRunLease(worktreeId, {
    env: params.env,
    validateCheckout: async (record, assertLeaseCurrent) => {
      await assertRequiredSessionWorktreeCheckout(record, () => {
        assertLeaseCurrent();
        assertCurrent();
      });
    },
  });
}
