import { render } from "lit";
import { describe, expect, it } from "vitest";
import { updatePickers } from "../../test-helpers/select-picker.ts";
import {
  buildSessionObserverTogglePatch,
  buildSessionObserverUtilityModelPatch,
  renderSessionObserverSettings,
} from "./session-observer-settings.ts";

describe("session observer settings patches", () => {
  it("uses null to restore the default toggle and false to opt out", () => {
    expect(buildSessionObserverTogglePatch(true)).toEqual({
      gateway: { controlUi: { sessionObserver: null } },
    });
    expect(buildSessionObserverTogglePatch(false)).toEqual({
      gateway: { controlUi: { sessionObserver: false } },
    });
  });

  it("distinguishes automatic, disabled, and explicit utility models", () => {
    expect(buildSessionObserverUtilityModelPatch({ kind: "auto" })).toEqual({
      agents: { defaults: { utilityModel: null } },
    });
    expect(buildSessionObserverUtilityModelPatch({ kind: "disabled" })).toEqual({
      agents: { defaults: { utilityModel: "" } },
    });
    expect(
      buildSessionObserverUtilityModelPatch({ kind: "model", model: "openai/gpt-5-mini" }),
    ).toEqual({
      agents: { defaults: { utilityModel: "openai/gpt-5-mini" } },
    });
  });

  it("keeps auto and disabled selectable when explicit models are unavailable", async () => {
    const container = document.createElement("div");
    render(
      renderSessionObserverSettings({
        enabled: true,
        utilityModel: undefined,
        resolvedUtilityModel: { status: "unavailable" },
        models: [{ id: "gpt-mini", name: "GPT Mini", provider: "openai" }],
        modelsUnavailable: true,
        disabled: false,
        onEnabledChange: () => undefined,
        onUtilityModelChange: () => undefined,
      }),
      container,
    );

    await updatePickers(container);
    const select = container.querySelector("openclaw-select-picker.model-picker__select");
    const options = [...(select?.querySelectorAll('[role="option"]') ?? [])];
    const option = (label: string) =>
      options.find((candidate) => candidate.textContent?.trim() === label);
    expect(select?.querySelector<HTMLButtonElement>("button")?.disabled).toBe(false);
    expect(option("Auto (provider default)")?.getAttribute("aria-disabled")).toBe("false");
    expect(option("Disabled")?.getAttribute("aria-disabled")).toBe("false");
    expect(option("GPT Mini")?.getAttribute("aria-disabled") === "true").toBe(true);
    expect(container.textContent).toContain("Explicit model catalog unavailable");
  });

  it.each([
    ["claude-cli", "auto (anthropic/claude-haiku-4-5 · Claude CLI · native)"],
    ["openclaw", "auto (anthropic/claude-haiku-4-5 · API · OpenClaw)"],
    [undefined, "auto (anthropic/claude-haiku-4-5)"],
  ])("names the resolved small model's %s route", (runtime, expected) => {
    const container = document.createElement("div");
    render(
      renderSessionObserverSettings({
        enabled: true,
        utilityModel: undefined,
        resolvedUtilityModel: {
          status: "auto",
          model: "anthropic/claude-haiku-4-5",
          ...(runtime ? { runtime } : {}),
        },
        models: [],
        modelsUnavailable: false,
        disabled: false,
        onEnabledChange: () => undefined,
        onUtilityModelChange: () => undefined,
      }),
      container,
    );
    expect(container.textContent).toContain(expected);
  });

  it("does not name the built-in runtime where it is not a route choice", () => {
    const container = document.createElement("div");
    render(
      renderSessionObserverSettings({
        enabled: true,
        utilityModel: "openai/gpt-5-mini",
        resolvedUtilityModel: {
          status: "configured",
          model: "openai/gpt-5-mini",
          runtime: "openclaw",
        },
        models: [],
        modelsUnavailable: false,
        disabled: false,
        onEnabledChange: () => undefined,
        onUtilityModelChange: () => undefined,
      }),
      container,
    );
    expect(container.textContent).toContain("configured (openai/gpt-5-mini)");
    expect(container.textContent).not.toContain("OpenClaw)");
  });
});
