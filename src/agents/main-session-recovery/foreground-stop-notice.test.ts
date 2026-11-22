import { describe, expect, it } from "vitest";
import type { SessionEntry } from "../../config/sessions/types.js";
import { transitionMainSessionRecovery } from "./main-session-recovery-state.js";
import { formatForegroundStopNotice } from "./main-session-restart-recovery-failure.js";

describe("foreground stop notice", () => {
  it("uses restart wording only with restart lifecycle evidence", () => {
    const restart = formatForegroundStopNotice("gateway-restart");
    expect(restart.startsWith("Stopped after restart.")).toBe(true);
    expect(restart).toContain("when the Gateway restarted");
    for (const interruption of ["unknown-cause", undefined] as const) {
      const unknown = formatForegroundStopNotice(interruption);
      expect(unknown.startsWith("Interrupted, not resumed.")).toBe(true);
      expect(unknown).not.toContain("Gateway restarted");
    }
    for (const text of [restart, formatForegroundStopNotice(undefined)]) {
      expect(text).toContain("for security reasons");
      expect(text).toContain("conversation history is preserved");
      expect(text).toContain("Some actions may already have completed");
      // Public product text uses no em dashes.
      expect(text).not.toMatch(/—/u);
    }
  });

  it("records the first interruption evidence of a recovery cycle", () => {
    const entry = { sessionId: "s", updatedAt: 1 } as SessionEntry;
    transitionMainSessionRecovery(entry, {
      kind: "mark_interrupted",
      cycleId: "cycle",
      now: 2,
      interruption: "gateway-restart",
    });
    expect(entry.mainRestartRecovery?.interruption).toBe("gateway-restart");
    transitionMainSessionRecovery(entry, {
      kind: "mark_interrupted",
      cycleId: "cycle-2",
      now: 3,
      interruption: "unknown-cause",
    });
    expect(entry.mainRestartRecovery?.interruption).toBe("gateway-restart");
  });
});
