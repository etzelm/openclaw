// Finds a system agent's stored CLI-backend conversations and carries Claude CLI ones to a new
// working directory, so a Doctor workspace pin does not restart them.
import fs from "node:fs";
import path from "node:path";
import { normalizeProviderId } from "@openclaw/model-catalog-core/provider-id";
import { normalizeOptionalString } from "@openclaw/normalization-core/string-coerce";
import { hashCliSessionText } from "../../../agents/cli-session.js";
import { resolveClaudeCliProjectDirForWorkspace } from "../../../agents/command/claude-cli-project-dir.js";
import { getCliSessionBinding } from "../../../config/sessions/cli-session-binding.js";
import {
  patchSessionEntryCore,
  scanDoctorSessionEntriesTolerant,
} from "../../../config/sessions/session-accessor.js";
import { resolveAllAgentSessionStoreTargetsSync } from "../../../config/sessions/targets.js";
import type { SessionEntry } from "../../../config/sessions/types.js";
import type { OpenClawConfig } from "../../../config/types.openclaw.js";
import { loadLegacySessionStore } from "../../../infra/state-migrations.legacy-session-store.js";
import { normalizeAgentId } from "../../../routing/session-key.js";
import { parseAgentSessionKey } from "../../../sessions/session-key-utils.js";

const CLAUDE_CLI = "claude-cli";

export type StoredCliConversation = {
  scope: { agentId: string; env: NodeJS.ProcessEnv; storePath: string; sessionKey: string };
  /** Backends holding a native conversation for this session. */
  providers: string[];
  /** Native Claude CLI session ids, from the binding, the id map, or the legacy field. */
  claudeSessionIds: string[];
  /** Read from a legacy sessions.json store, which this repair does not rewrite. */
  legacyStore: boolean;
};

function isSafeClaudeSessionId(id: string | undefined): id is string {
  return id !== undefined && id !== "." && id !== ".." && !/[\0/\\]/.test(id);
}

function describeConversation(entry: SessionEntry) {
  const providers = [
    ...Object.keys(entry.cliSessionBindings ?? {}),
    ...Object.keys(entry.cliSessionIds ?? {}),
  ].filter((provider) => getCliSessionBinding(entry, provider));
  const legacyClaudeId = normalizeOptionalString(entry.claudeCliSessionId);
  if (legacyClaudeId !== undefined) {
    providers.push(CLAUDE_CLI);
  }
  const claudeSessionIds = [getCliSessionBinding(entry, CLAUDE_CLI)?.sessionId, legacyClaudeId];
  return {
    providers: [...new Set(providers.map(normalizeProviderId))],
    claudeSessionIds: [...new Set(claudeSessionIds.filter((id) => id !== undefined))],
  };
}

/**
 * Lists the agent's stored sessions bound to a CLI-backend conversation. The binding records the
 * working directory it started in, so changing that directory starts a new native conversation
 * unless the conversation is carried along.
 */
export function listStoredCliConversations(
  cfg: OpenClawConfig,
  agentId: string,
  env: NodeJS.ProcessEnv,
): StoredCliConversation[] {
  const conversations = new Map<string, StoredCliConversation>();
  const visit = (
    sessionKey: string,
    entry: SessionEntry,
    target: { agentId: string; storePath: string },
    legacyStore: boolean,
  ) => {
    const owner = parseAgentSessionKey(sessionKey)?.agentId ?? target.agentId;
    if (normalizeAgentId(owner) !== agentId) {
      return;
    }
    const { providers, claudeSessionIds } = describeConversation(entry);
    if (providers.length > 0 && !conversations.get(sessionKey)?.legacyStore) {
      conversations.set(sessionKey, {
        scope: { agentId: target.agentId, env, storePath: target.storePath, sessionKey },
        providers,
        claudeSessionIds,
        legacyStore,
      });
    }
  };
  for (const target of resolveAllAgentSessionStoreTargetsSync(cfg, { env })) {
    scanDoctorSessionEntriesTolerant(
      { agentId: target.agentId, env, storePath: target.storePath },
      ({ entry, sessionKey }) => visit(sessionKey, entry, target, false),
    );
    if (!target.storePath.endsWith(".sqlite") && fs.existsSync(target.storePath)) {
      for (const [sessionKey, entry] of Object.entries(loadLegacySessionStore(target.storePath))) {
        if (entry && typeof entry === "object") {
          visit(sessionKey, entry, target, true);
        }
      }
    }
  }
  return [...conversations.values()];
}

/** Only Claude CLI conversations in the SQLite store can be carried to a new directory. */
export function canCarryCliConversation(
  conversation: StoredCliConversation,
  env: NodeJS.ProcessEnv,
): boolean {
  return (
    !conversation.legacyStore &&
    normalizeOptionalString(env.HOME) !== undefined &&
    conversation.providers.every((provider) => provider === CLAUDE_CLI) &&
    conversation.claudeSessionIds.every(isSafeClaudeSessionId)
  );
}

/**
 * Copies the conversation's Claude CLI transcript into the Claude project folder of the new
 * directory (the original stays in place) and records the new directory in its binding, so the
 * next turn resumes the same native session with its history.
 */
export async function carryClaudeCliConversation(
  conversation: StoredCliConversation,
  from: string,
  to: string,
  env: NodeJS.ProcessEnv,
): Promise<void> {
  const homeDir = normalizeOptionalString(env.HOME);
  const fromProject = resolveClaudeCliProjectDirForWorkspace({ workspaceDir: from, homeDir });
  const toProject = resolveClaudeCliProjectDirForWorkspace({ workspaceDir: to, homeDir });
  for (const sessionId of conversation.claudeSessionIds) {
    // `<id>.jsonl` is the transcript; a sibling `<id>/` folder holds its tool results.
    for (const name of [`${sessionId}.jsonl`, sessionId]) {
      const source = path.join(fromProject, name);
      if (fs.existsSync(source)) {
        await fs.promises.mkdir(toProject, { recursive: true });
        await fs.promises.cp(source, path.join(toProject, name), {
          recursive: true,
          force: false,
          errorOnExist: false,
        });
      }
    }
  }
  const fromHash = hashCliSessionText(from);
  await patchSessionEntryCore(
    conversation.scope,
    (entry) => {
      const key = Object.keys(entry.cliSessionBindings ?? {}).find(
        (provider) => normalizeProviderId(provider) === CLAUDE_CLI,
      );
      const binding = key ? entry.cliSessionBindings?.[key] : undefined;
      if (!key || !binding || binding.cwdHash !== fromHash) {
        return null;
      }
      return {
        cliSessionBindings: {
          ...entry.cliSessionBindings,
          [key]: { ...binding, cwdHash: hashCliSessionText(to) },
        },
      };
    },
    { preserveActivity: true, skipMaintenance: true },
  );
}
