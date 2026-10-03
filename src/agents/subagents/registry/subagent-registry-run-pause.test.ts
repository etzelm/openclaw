import { describe, expect, it } from "vitest";
import { createSubagentRunRecord } from "../../subagent-test-fixtures.test-helpers.js";
import {
  markSubagentRunPausedAfterYield,
  resolveYieldedRunContinuation,
} from "./subagent-registry-run-pause.js";

const YIELDED_WAIT_MAX_AGE_MS = 24 * 60 * 60_000;

const PAUSED_AT = Date.parse("2026-10-03T08:00:00Z");
const yielded = (overrides: Parameters<typeof createSubagentRunRecord>[0]) =>
  createSubagentRunRecord({
    pauseReason: "sessions_yield",
    createdAt: PAUSED_AT - 60_000,
    startedAt: PAUSED_AT - 30_000,
    endedAt: PAUSED_AT,
    ...overrides,
  });

describe("resolveYieldedRunContinuation", () => {
  it("never lets a continuation reach a collector without a recorded result", () => {
    expect(
      resolveYieldedRunContinuation(yielded({ runId: "c", collect: true }), PAUSED_AT, false),
    ).toEqual({
      state: "unreachable",
      error: expect.stringContaining("Collector yielded"),
    });
  });

  it("bounds a leaf wait by the age of its pause, inclusive at the bound", () => {
    const leaf = yielded({ runId: "leaf", expectsCompletionMessage: true });
    const at = (offsetMs: number) =>
      resolveYieldedRunContinuation(leaf, PAUSED_AT + YIELDED_WAIT_MAX_AGE_MS + offsetMs, false)
        .state;
    expect([at(-1), at(0), at(1)]).toEqual(["continuable", "unreachable", "unreachable"]);
    expect(resolveYieldedRunContinuation(leaf, PAUSED_AT + YIELDED_WAIT_MAX_AGE_MS, false)).toEqual(
      {
        state: "unreachable",
        error: "Subagent yielded and no continuation arrived within 24 hours of its pause.",
      },
    );
  });

  it.each([
    {
      label: "a collector that already has a frozen result",
      overrides: { collect: true, collectorCompletion: { status: "done" as const } },
      awaitsChildren: false,
    },
    {
      label: "an orchestrator flagged to wake on descendants",
      overrides: { expectsCompletionMessage: true, wakeOnDescendantSettle: true },
      awaitsChildren: false,
    },
    {
      label: "a requester that still awaits unfinished children",
      overrides: { expectsCompletionMessage: true },
      awaitsChildren: true,
    },
  ])("keeps $label continuable past the age bound", ({ overrides, awaitsChildren }) => {
    const entry = yielded({ runId: "kept", ...overrides });
    expect(
      resolveYieldedRunContinuation(
        entry,
        PAUSED_AT + 10 * YIELDED_WAIT_MAX_AGE_MS,
        awaitsChildren,
      ),
    ).toEqual({ state: "continuable" });
  });

  it("never measures the age from an end that precedes the row's own creation", () => {
    const leaf = yielded({
      runId: "skewed",
      expectsCompletionMessage: true,
      createdAt: PAUSED_AT,
      endedAt: PAUSED_AT - 10 * YIELDED_WAIT_MAX_AGE_MS,
    });
    expect(
      resolveYieldedRunContinuation(leaf, PAUSED_AT + YIELDED_WAIT_MAX_AGE_MS - 1, false),
    ).toEqual({ state: "continuable" });
    expect(
      resolveYieldedRunContinuation(leaf, PAUSED_AT + YIELDED_WAIT_MAX_AGE_MS, false).state,
    ).toBe("unreachable");
  });

  it("reads the pause time from the existing execution record and never from the clock alone", () => {
    const unended = createSubagentRunRecord({
      runId: "unended",
      pauseReason: "sessions_yield",
      expectsCompletionMessage: true,
      startedAt: PAUSED_AT,
    });
    expect(unended.execution.endedAt).toBeUndefined();
    expect(
      resolveYieldedRunContinuation(unended, PAUSED_AT + 10 * YIELDED_WAIT_MAX_AGE_MS, false),
    ).toEqual({ state: "continuable" });
  });
});

describe("the pause time that bounds a yielded wait", () => {
  it("is the execution end recorded by the pause and survives a repeated report of the same yield", () => {
    const entry = createSubagentRunRecord({ runId: "paused", startedAt: PAUSED_AT - 30_000 });
    expect(markSubagentRunPausedAfterYield({ entry, endedAt: PAUSED_AT })).toBe(true);
    expect(entry.pauseReason).toBe("sessions_yield");
    expect(entry.execution).toMatchObject({ status: "terminal", endedAt: PAUSED_AT });
    // agent.wait and the lifecycle event can both report the yield; the pause time stays put.
    markSubagentRunPausedAfterYield({ entry, endedAt: PAUSED_AT });
    expect(entry.execution.endedAt).toBe(PAUSED_AT);
  });
});
