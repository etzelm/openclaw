import { describe, expect, it } from "vitest";
import { resolveCliNoOutputTimeoutDecision } from "./no-output-timeout-policy.js";

const CONTEXT = {
  provider: "claude-cli",
  model: "claude-sonnet-4-6",
  sessionId: "s1",
  lane: undefined,
};
const OUTSTANDING_WORK_GRACE_MS = 900_000;

describe("resolveCliNoOutputTimeoutDecision", () => {
  it("defers past the no-output budget while native compaction is active", () => {
    const decision = resolveCliNoOutputTimeoutDecision({
      context: CONTEXT,
      timeoutMs: 100,
      quietDurationMs: 100,
      cliTimeout: {
        mode: "no-output",
        timeoutSeconds: 0,
        observedActivity: true,
        activeToolCount: 0,
        backgroundTaskCount: 0,
        compactionActive: true,
      },
      hasOutputText: false,
      useResume: false,
      hasReplayUnsafeActivity: true,
      outstandingWorkGraceMs: OUTSTANDING_WORK_GRACE_MS,
    });

    expect(decision.deferMs).toBe(OUTSTANDING_WORK_GRACE_MS - 100);
  });

  it("terminates once compaction has ended even with no other outstanding work", () => {
    const decision = resolveCliNoOutputTimeoutDecision({
      context: CONTEXT,
      timeoutMs: 100,
      quietDurationMs: 100,
      cliTimeout: {
        mode: "no-output",
        timeoutSeconds: 100,
        observedActivity: true,
        activeToolCount: 0,
        backgroundTaskCount: 0,
        compactionActive: false,
      },
      hasOutputText: false,
      useResume: false,
      hasReplayUnsafeActivity: true,
      outstandingWorkGraceMs: OUTSTANDING_WORK_GRACE_MS,
    });

    expect(decision.deferMs).toBeUndefined();
    expect(decision.error.message).toBe("CLI produced no output for 100s and was terminated.");
  });

  it("terminates when no compaction lifecycle event was ever observed", () => {
    const decision = resolveCliNoOutputTimeoutDecision({
      context: CONTEXT,
      timeoutMs: 100,
      quietDurationMs: 100,
      cliTimeout: {
        mode: "no-output",
        timeoutSeconds: 100,
        observedActivity: true,
        activeToolCount: 0,
        backgroundTaskCount: 0,
        // A non-Claude backend never reports parseJsonlLifecycleEvent results,
        // so `compactionActive` is never set here, exactly like before this field existed.
      },
      hasOutputText: false,
      useResume: false,
      hasReplayUnsafeActivity: true,
      outstandingWorkGraceMs: OUTSTANDING_WORK_GRACE_MS,
    });

    expect(decision.deferMs).toBeUndefined();
    expect(decision.error.message).toBe("CLI produced no output for 100s and was terminated.");
  });

  it("still counts active tool or background work when compaction is not active", () => {
    const decision = resolveCliNoOutputTimeoutDecision({
      context: CONTEXT,
      timeoutMs: 100,
      quietDurationMs: 100,
      cliTimeout: {
        mode: "no-output",
        timeoutSeconds: 0,
        observedActivity: true,
        activeToolCount: 1,
        backgroundTaskCount: 0,
        compactionActive: false,
      },
      hasOutputText: false,
      useResume: false,
      hasReplayUnsafeActivity: true,
      outstandingWorkGraceMs: OUTSTANDING_WORK_GRACE_MS,
    });

    expect(decision.deferMs).toBe(OUTSTANDING_WORK_GRACE_MS - 100);
  });
});
