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
  const agentHarnessRuntimeOverride =
    params.useUtilityModel && !params.modelRef?.trim()
      ? resolveAutomaticUtilityRuntimeOverride({
          cfg: params.cfg,
          agentId: params.agentId,
          utilityProvider: selection.provider,
          utilityModelId: selection.modelId,
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
