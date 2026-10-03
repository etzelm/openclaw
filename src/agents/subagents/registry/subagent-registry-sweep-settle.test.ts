import { describe, expect, it, vi } from "vitest";
import { createSubagentRunRecord } from "../../subagent-test-fixtures.test-helpers.js";
import { settleUnreachableYieldedSubagentRun } from "./subagent-registry-sweep-settle.js";
import type { SubagentRunRecord } from "./subagent-registry.types.js";

const YIELDED_WAIT_MAX_AGE_MS = 24 * 60 * 60_000;
const PAUSED_AT = Date.parse("2026-10-03T08:00:00Z");
const PAST_BOUND = PAUSED_AT + YIELDED_WAIT_MAX_AGE_MS;

const leaf = (overrides: Partial<SubagentRunRecord> = {}) =>
  createSubagentRunRecord({
    runId: "parked-leaf",
    pauseReason: "sessions_yield",
    expectsCompletionMessage: true,
    createdAt: PAUSED_AT - 60_000,
    startedAt: PAUSED_AT - 30_000,
    endedAt: PAUSED_AT,
    ...overrides,
  } as Parameters<typeof createSubagentRunRecord>[0]);

const settle = async (entry: SubagentRunRecord, now = PAST_BOUND) => {
  const complete = vi.fn(async () => undefined);
  const settled = await settleUnreachableYieldedSubagentRun({
    runId: entry.runId,
    entry,
    runs: [entry],
    now,
    complete,
  });
  return { settled, complete };
};

describe("settleUnreachableYieldedSubagentRun", () => {
  it("asks the completion owner to settle an expired leaf at the time it paused", async () => {
    const entry = leaf();
    const { settled, complete } = await settle(entry);
    expect(settled).toBe(true);
    expect(complete).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: "parked-leaf",
        expectedEntry: entry,
        endedAt: PAUSED_AT,
        settleYielded: true,
        outcome: { status: "error", error: expect.stringContaining("within 24 hours") },
      }),
      "sweeper-unreachable-yield",
    );
  });

  it("leaves a leaf inside the bound alone", async () => {
    const { settled, complete } = await settle(leaf(), PAST_BOUND - 1);
    expect(settled).toBe(false);
    expect(complete).not.toHaveBeenCalled();
  });

  it.each([
    {
      label: "kill intent",
      overrides: { killIntent: { requestedAt: PAUSED_AT, reason: "operator" } },
    },
    { label: "kill reconciliation", overrides: { killReconciliation: { killedAt: PAUSED_AT } } },
    { label: "a killed announce suppression", overrides: { suppressAnnounceReason: "killed" } },
    { label: "a killed ended reason", overrides: { endedReason: "subagent-killed" } },
    { label: "a resumed run", overrides: { pauseReason: undefined } },
  ] as const)("never settles a row excluded as not yielded: $label", async ({ overrides }) => {
    for (const collect of [false, true]) {
      const { settled, complete } = await settle(
        leaf({
          ...(collect ? { collect: true, expectsCompletionMessage: false } : {}),
          ...overrides,
        }),
      );
      expect(settled, `collect=${collect}`).toBe(false);
      expect(complete).not.toHaveBeenCalled();
    }
  });
});
