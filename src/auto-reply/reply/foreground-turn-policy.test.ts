import { MAX_TIMER_TIMEOUT_MS } from "@openclaw/normalization-core/number-coercion";
import { describe, expect, it } from "vitest";
import { DEFAULT_AGENT_TIMEOUT_MS } from "../../agents/timeout.js";
import type { OpenClawConfig } from "../../config/types.openclaw.js";
import { FOREGROUND_BUSY_REPLY, resolveForegroundTurnTimeoutMs } from "./foreground-turn-policy.js";

const withTimeout = (timeoutSeconds: number): OpenClawConfig => ({
  agents: { defaults: { timeoutSeconds } },
});

describe("foreground turn deadline", () => {
  it("never leaves a foreground turn without a finite deadline", () => {
    for (const unlimited of [0, MAX_TIMER_TIMEOUT_MS]) {
      expect(resolveForegroundTurnTimeoutMs(unlimited, true, withTimeout(0))).toBe(
        DEFAULT_AGENT_TIMEOUT_MS,
      );
    }
  });

  it("keeps the operator's configured finite timeout", () => {
    expect(resolveForegroundTurnTimeoutMs(600_000, true, withTimeout(600))).toBe(600_000);
    expect(resolveForegroundTurnTimeoutMs(3_600_000, true, withTimeout(3600))).toBe(3_600_000);
  });

  it("lets a per-request override shorten a foreground turn but never extend it", () => {
    const cfg = withTimeout(600);
    expect(resolveForegroundTurnTimeoutMs(60_000, true, cfg)).toBe(60_000);
    for (const requested of [2_000_000_000, MAX_TIMER_TIMEOUT_MS, 0, 600_001]) {
      expect(resolveForegroundTurnTimeoutMs(requested, true, cfg)).toBe(600_000);
    }
  });

  it("keeps staff and ordinary turn timeouts unchanged", () => {
    const cfg = withTimeout(600);
    expect(resolveForegroundTurnTimeoutMs(MAX_TIMER_TIMEOUT_MS, false, cfg)).toBe(
      MAX_TIMER_TIMEOUT_MS,
    );
    expect(resolveForegroundTurnTimeoutMs(0, false, cfg)).toBe(0);
    expect(resolveForegroundTurnTimeoutMs(2_000_000_000, false, cfg)).toBe(2_000_000_000);
  });

  it("explains a busy-thread rejection without queueing", () => {
    expect(FOREGROUND_BUSY_REPLY).toContain("It was not queued.");
    expect(FOREGROUND_BUSY_REPLY).not.toMatch(/—/u);
  });
});
