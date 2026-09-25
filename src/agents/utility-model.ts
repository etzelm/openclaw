// Resolves the utility model used for short internal tasks (titles, progress
// narration). Unset config derives the provider-declared small model from the
// agent's primary provider; an explicit empty string disables utility routing.
import type { OpenClawConfig } from "../config/types.openclaw.js";
import {
  hasUtilityModelSeparationMigrationMarker,
  resolveLegacyImplicitPrimaryModelRef,
} from "../config/utility-model-separation-migration.js";
import { getCurrentPluginMetadataSnapshot } from "../plugins/current-plugin-metadata-snapshot.js";
import type { PluginMetadataSnapshot } from "../plugins/plugin-metadata-snapshot.types.js";
import { isDefaultAgentRuntimeId } from "./agent-runtime-id.js";
import { resolveNativeModelPrimary } from "./agent-scope.js";
import { resolveAgentHarnessPolicy } from "./harness/policy.js";
import { splitTrailingAuthProfile } from "./model-ref-profile.js";
import { resolveDefaultModelForAgent } from "./model-selection.js";
import { readUtilityModelSetting } from "./utility-model-setting.js";

/** Legacy utility settings did not remove the ordinary implicit primary route. */
export function resolveConfiguredPrimaryModelForAgent(params: {
  cfg: OpenClawConfig;
  agentId: string;
}): string | undefined {
  const primary = resolveNativeModelPrimary(params.cfg, params.agentId)?.trim();
  if (primary) {
    return primary;
  }
  return !hasUtilityModelSeparationMigrationMarker(params.cfg) &&
    readUtilityModelSetting(params.cfg, params.agentId).kind === "explicit"
    ? resolveLegacyImplicitPrimaryModelRef(params.cfg)
    : undefined;
}

/** Setup can use an explicit utility model until the agent has its own primary. */
export function resolveConfiguredSetupModelForAgent(params: {
  cfg: OpenClawConfig;
  agentId: string;
  /** An explicit utility selection is used only to verify that configuration role. */
  modelTarget?: "utility";
}): { modelRef: string; modelTarget?: "utility"; implicitPrimary?: true } | undefined {
  const primary = resolveConfiguredPrimaryModelForAgent(params);
  if (primary && params.modelTarget !== "utility") {
    return {
      modelRef: primary,
      ...(!resolveNativeModelPrimary(params.cfg, params.agentId)?.trim()
        ? { implicitPrimary: true as const }
        : {}),
    };
  }
  const utility = readUtilityModelSetting(params.cfg, params.agentId);
  return utility.kind === "explicit"
    ? { modelRef: utility.modelRef, modelTarget: "utility" }
    : undefined;
}

/**
 * Automatic utility model for an already-resolved primary provider (manifest
 * `modelCatalog.providers.<id>.defaultUtilityModel`), or undefined when the
 * provider does not declare one. Reads only the process-current plugin
 * metadata snapshot, so the lookup stays synchronous and cheap; contexts
 * without a snapshot simply get no derived default.
 */
export function resolveAutomaticUtilityModelRef(params: {
  cfg: OpenClawConfig;
  primaryProvider: string;
  primaryModelRef?: string;
  metadataSnapshot?: Pick<PluginMetadataSnapshot, "plugins">;
}): string | undefined {
  const provider = params.primaryProvider.trim().toLowerCase();
  if (!provider) {
    return undefined;
  }
  const snapshot =
    params.metadataSnapshot ??
    getCurrentPluginMetadataSnapshot({
      config: params.cfg,
      allowWorkspaceScopedSnapshot: true,
    });
  if (!snapshot) {
    return undefined;
  }
  for (const plugin of snapshot.plugins) {
    const defaultUtilityModel = plugin.modelCatalog?.providers?.[provider]?.defaultUtilityModel;
    const modelId = defaultUtilityModel?.trim();
    if (modelId) {
      const derived = `${provider}/${modelId}`;
      // Automatic routing stays with the primary model's explicit auth owner.
      const profile = params.primaryModelRef
        ? splitTrailingAuthProfile(params.primaryModelRef).profile
        : undefined;
      return profile ? `${derived}@${profile}` : derived;
    }
  }
  return undefined;
}

/**
 * The utility model ref to use for the agent, or undefined when utility
 * routing is disabled or no default exists. Callers with a session-specific
 * selection pass both primary fields so automatic routing keeps that session's
 * provider and auth owner.
 */
export function resolveUtilityModelRefForAgent(params: {
  cfg: OpenClawConfig;
  agentId: string;
  /** Pass when the caller already resolved the primary provider. */
  primaryProvider?: string;
  /** Pass with primaryProvider to carry a session-specific auth profile. */
  primaryModelRef?: string;
  metadataSnapshot?: Pick<PluginMetadataSnapshot, "plugins">;
}): string | undefined {
  const setting = readUtilityModelSetting(params.cfg, params.agentId);
  if (setting.kind === "explicit") {
    return setting.modelRef;
  }
  if (setting.kind === "disabled") {
    return undefined;
  }
  const provider =
    params.primaryProvider?.trim() ||
    resolveDefaultModelForAgent({ cfg: params.cfg, agentId: params.agentId }).provider;
  return resolveAutomaticUtilityModelRef({
    cfg: params.cfg,
    primaryProvider: provider,
    primaryModelRef:
      params.primaryModelRef?.trim() || resolveNativeModelPrimary(params.cfg, params.agentId),
    metadataSnapshot: params.metadataSnapshot,
  });
}

/**
 * The agent runtime an automatically derived utility model must execute on, or
 * undefined when it already resolves its own.
 *
 * Automatic routing derives a small model from the primary's provider, so the
 * derived ref matches no configured model entry of its own. A runtime pinned on
 * the primary model entry (`agents.defaults.models["<provider>/<model>"].
 * agentRuntime`) therefore does not carry, and the derived ref silently falls
 * back to the default runtime and its HTTP auth path. For a CLI-backed primary
 * such as `claude-cli` that provider holds no API key on purpose, so the
 * completion fails with "No API key found" even though the primary works.
 *
 * Inheriting only when the derived model resolves to the default runtime keeps
 * the other routes untouched: a provider-level `agentRuntime` already applies to
 * every model of that provider, and an implicit runtime (OpenAI's Codex harness)
 * is re-derived identically for the small model, so both leave the derived
 * runtime non-default and skip inheritance.
 */
export function resolveAutomaticUtilityRuntimeOverride(params: {
  cfg: OpenClawConfig;
  agentId: string;
  /** Provider and model of the already-resolved utility selection. */
  utilityProvider: string;
  utilityModelId: string;
}): string | undefined {
  // An explicit utilityModel owns its own runtime; only automatic routing inherits.
  if (readUtilityModelSetting(params.cfg, params.agentId).kind !== "auto") {
    return undefined;
  }
  const primary = resolveDefaultModelForAgent({ cfg: params.cfg, agentId: params.agentId });
  const utilityProvider = params.utilityProvider.trim().toLowerCase();
  if (!primary.provider || !primary.model || primary.provider.toLowerCase() !== utilityProvider) {
    return undefined;
  }
  const derived = resolveAgentHarnessPolicy({
    provider: params.utilityProvider,
    modelId: params.utilityModelId,
    config: params.cfg,
    agentId: params.agentId,
  });
  if (!isDefaultAgentRuntimeId(derived.runtime)) {
    return undefined;
  }
  const primaryPolicy = resolveAgentHarnessPolicy({
    provider: primary.provider,
    modelId: primary.model,
    config: params.cfg,
    agentId: params.agentId,
  });
  return isDefaultAgentRuntimeId(primaryPolicy.runtime) ? undefined : primaryPolicy.runtime;
}
