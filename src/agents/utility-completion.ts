import { resolveSimpleCompletionSelectionForAgent } from "./simple-completion-runtime.js";
import { resolveAutomaticUtilityRuntimeOverride } from "./utility-model.js";

/** Keep visible-text retry/fallback in callers; the runtime owns authentication. */
export async function prepareUtilityCompletionForAgent(
  params: Parameters<typeof resolveSimpleCompletionSelectionForAgent>[0] & {
    preferredProfile?: string;
  },
) {
  const selection = resolveSimpleCompletionSelectionForAgent(params);
  if (!selection) {
    throw new Error(`No utility model configured for agent ${params.agentId}.`);
  }
  // An automatically derived small model carries no model entry of its own, so
  // it must execute on the primary's runtime instead of the default HTTP route.
  // This is keyed on the resolved selection rather than on an absent modelRef:
  // the session observer passes the already-derived ref back in, so gating on
  // `!modelRef` would skip the very path that reported this. The helper still
  // confirms the selection is the derived model, so an explicitly selected
  // same-provider ref keeps its own route.
  const agentHarnessRuntimeOverride = params.useUtilityModel
    ? resolveAutomaticUtilityRuntimeOverride({
        cfg: params.cfg,
        agentId: params.agentId,
        utilityProvider: selection.provider,
        utilityModelId: selection.modelId,
        ...(params.manifestPlugins
          ? {
              metadataSnapshot:
                "plugins" in params.manifestPlugins
                  ? params.manifestPlugins
                  : { plugins: params.manifestPlugins },
            }
          : {}),
      })
    : undefined;
  return {
    config: params.cfg,
    provider: selection.provider,
    model: selection.modelId,
    authProfileId: selection.profileId ?? params.preferredProfile,
    outputTextPolicy: "strict-visible" as const,
    agentId: params.agentId,
    agentDir: selection.agentDir,
    ...(agentHarnessRuntimeOverride ? { agentHarnessRuntimeOverride } : {}),
  };
}
