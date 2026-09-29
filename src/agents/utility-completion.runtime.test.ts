import { describe, expect, it } from "vitest";
import type { OpenClawConfig } from "../config/types.openclaw.js";
import { resolveUtilityCompletionRuntimeForAgent } from "./utility-completion.js";

function config(utilityModelEntry?: { agentRuntime: { id: string } }): OpenClawConfig {
  return {
    agents: {
      defaults: {
        model: { primary: "anthropic/claude-opus-4-6" },
        utilityModel: "anthropic/claude-haiku-4-5",
        ...(utilityModelEntry
          ? { models: { "anthropic/claude-haiku-4-5": utilityModelEntry } }
          : {}),
      },
    },
  } as OpenClawConfig;
}

describe("resolveUtilityCompletionRuntimeForAgent", () => {
  it("reports the Claude CLI owner a utility model's runtime pin dispatches to", async () => {
    await expect(
      resolveUtilityCompletionRuntimeForAgent({
        cfg: config({ agentRuntime: { id: "claude-cli" } }),
        agentId: "main",
      }),
    ).resolves.toBe("claude-cli");
  });

  it("reports the built-in HTTP runtime for a utility model without a CLI route", async () => {
    await expect(
      resolveUtilityCompletionRuntimeForAgent({ cfg: config(), agentId: "main" }),
    ).resolves.toBe("openclaw");
  });
});
