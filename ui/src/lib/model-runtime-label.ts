import { resolveModelRuntimeRoute } from "../../../src/shared/model-runtime-route.js";
import { t } from "../i18n/index.ts";
import { registerModelControlsEnglish } from "../i18n/locales/en-model-controls.ts";

registerModelControlsEnglish();

// Known models.list runtime ids; mirrors src/status/agent-runtime-label.ts,
// which cannot be imported here (it drags terminal sanitizers into the bundle).
const AGENT_RUNTIME_LABELS: Readonly<Record<string, string>> = {
  "claude-cli": "Claude CLI",
  codex: "Codex",
  "codex-cli": "Codex",
  "google-gemini-cli": "Gemini CLI",
  openclaw: "OpenClaw",
};

export function formatAgentRuntimeLabel(id: string): string {
  const normalized = id.trim().toLowerCase();
  return (
    AGENT_RUNTIME_LABELS[normalized] ??
    `${normalized.charAt(0).toUpperCase()}${normalized.slice(1)}`
  );
}

/**
 * Route label for a model on a runtime: Anthropic's API/Claude CLI routes get
 * their billing-aware labels, other known runtimes their display name.
 */
export function formatModelRuntimeLabel(
  provider: string,
  runtimeId: string | undefined,
): { label: string; detail?: string } | undefined {
  const route = resolveModelRuntimeRoute(provider, runtimeId);
  if (route) {
    return {
      label: t(`chat.modelControls.routes.${route}.label`),
      detail: t(`chat.modelControls.routes.${route}.detail`),
    };
  }
  return runtimeId ? { label: formatAgentRuntimeLabel(runtimeId) } : undefined;
}

/**
 * Route label for a resolved utility model. The built-in runtime is only
 * named where it distinguishes a route (Anthropic API vs Claude CLI).
 */
export function formatUtilityModelRuntimeLabel(
  modelRef: string,
  runtimeId: string | undefined,
): string | undefined {
  if (!runtimeId) {
    return undefined;
  }
  const provider = modelRef.split("/", 1)[0]?.trim().toLowerCase() ?? "";
  if (runtimeId === "openclaw" && !resolveModelRuntimeRoute(provider, runtimeId)) {
    return undefined;
  }
  return formatModelRuntimeLabel(provider, runtimeId)?.label;
}
