// Utility completion carries the execution owner, not HTTP credentials, so a
// CLI-backed primary must hand its runtime to the auto-derived small model.
import { describe, expect, it } from "vitest";
import type { OpenClawConfig } from "../config/types.openclaw.js";
import type { PluginMetadataSnapshot } from "../plugins/plugin-metadata-snapshot.types.js";
import { prepareUtilityCompletionForAgent } from "./utility-completion.js";

const manifestPlugins = [
  {
    id: "anthropic",
    modelCatalog: {
      providers: {
        anthropic: {
          defaultUtilityModel: "claude-haiku-4-5",
          // claude-sonnet-5 is a same-provider model with no config entry of its
          // own, so it resolves the default HTTP runtime and must stay there.
          models: [{ id: "claude-haiku-4-5" }, { id: "claude-opus-5" }, { id: "claude-sonnet-5" }],
        },
      },
    },
  },
] as unknown as PluginMetadataSnapshot["plugins"];

const cliPrimary = {
  agents: {
    defaults: {
      model: "anthropic/claude-opus-5",
      models: { "anthropic/claude-opus-5": { agentRuntime: { id: "claude-cli" } } },
    },
  },
} as OpenClawConfig;

describe("prepareUtilityCompletionForAgent", () => {
  it("routes the auto-derived utility model through the primary's CLI runtime", async () => {
    const prepared = await prepareUtilityCompletionForAgent({
      cfg: cliPrimary,
      agentId: "main",
      useUtilityModel: true,
      manifestPlugins,
    });

    expect(prepared.provider).toBe("anthropic");
    expect(prepared.model).toBe("claude-haiku-4-5");
    expect(prepared).toHaveProperty("agentHarnessRuntimeOverride", "claude-cli");
  });

  // session-observer-completion.ts resolves the utility ref itself and passes it
  // back as modelRef, so the override must survive that shape too. Gating on an
  // absent modelRef left the reported path (#138789) unfixed.
  it("routes the session observer's pre-resolved ref through the CLI runtime", async () => {
    const prepared = await prepareUtilityCompletionForAgent({
      cfg: cliPrimary,
      agentId: "main",
      modelRef: "anthropic/claude-haiku-4-5",
      useUtilityModel: true,
      manifestPlugins,
    });

    expect(prepared.provider).toBe("anthropic");
    expect(prepared.model).toBe("claude-haiku-4-5");
    expect(prepared).toHaveProperty("agentHarnessRuntimeOverride", "claude-cli");
  });

  // Selection prefers a caller-supplied modelRef over automatic derivation, so
  // useUtilityModel alone does not prove the ref was derived. Inheriting on
  // provider equality alone would move this call off HTTP and onto the primary's
  // CLI subscription quota without any config change.
  it("leaves an explicitly selected same-provider model on its own runtime", async () => {
    const prepared = await prepareUtilityCompletionForAgent({
      cfg: cliPrimary,
      agentId: "main",
      modelRef: "anthropic/claude-sonnet-5",
      useUtilityModel: true,
      manifestPlugins,
    });

    expect(prepared.provider).toBe("anthropic");
    expect(prepared.model).toBe("claude-sonnet-5");
    expect(prepared).not.toHaveProperty("agentHarnessRuntimeOverride");
  });

  it("leaves an explicit utility model on its own runtime", async () => {
    const cfg = {
      agents: {
        defaults: {
          ...cliPrimary.agents?.defaults,
          utilityModel: "anthropic/claude-haiku-4-5",
        },
      },
    } as OpenClawConfig;

    const prepared = await prepareUtilityCompletionForAgent({
      cfg,
      agentId: "main",
      useUtilityModel: true,
      manifestPlugins,
    });

    expect(prepared).not.toHaveProperty("agentHarnessRuntimeOverride");
  });

  it("leaves a primary on the default runtime alone", async () => {
    const cfg = {
      agents: { defaults: { model: "anthropic/claude-opus-5" } },
    } as OpenClawConfig;

    const prepared = await prepareUtilityCompletionForAgent({
      cfg,
      agentId: "main",
      useUtilityModel: true,
      manifestPlugins,
    });

    expect(prepared).not.toHaveProperty("agentHarnessRuntimeOverride");
  });
});
