import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetGatewayWorkAdmission } from "../../../process/gateway-work-admission.js";
import { SUBAGENT_ENDED_REASON_ERROR } from "./subagent-lifecycle-events.js";
import { persistSubagentSessionTiming } from "./subagent-registry-helpers.js";
import {
  createLifecycleControllerFixture,
  createRunEntry,
  mutateLifecycleRun,
  readLifecycleRun,
} from "./subagent-registry-lifecycle-controller.test-support.js";
import type { SubagentRunRecord } from "./subagent-registry.types.js";

vi.mock("./subagent-registry-helpers.js", { spy: true });
vi.mock("../../agent-bundle-mcp-tools.js", () => ({
  retireSessionMcpRuntimeForSessionKey: vi.fn(async () => true),
}));

beforeEach(() => {
  resetGatewayWorkAdmission();
  vi.mocked(persistSubagentSessionTiming).mockResolvedValue(undefined);
});

const createController = (entry: SubagentRunRecord) =>
  createLifecycleControllerFixture(
    { entry },
    {
      callGateway: async () => {
        throw new Error("Unexpected Gateway call");
      },
      cleanupBrowserSessionsForLifecycleEnd: vi.fn(async () => {}),
      ownersByEntry: new Map(),
    },
  );

const request = (entry: SubagentRunRecord, overrides: { settleYielded?: true } = {}) => ({
  runId: entry.runId,
  endedAt: 4_000,
  outcome: { status: "error" as const, error: "no continuation can reach this run" },
  reason: SUBAGENT_ENDED_REASON_ERROR,
  triggerCleanup: false,
  ...overrides,
});

describe("settling a yielded run through the completion owner", () => {
  it("completes a yielded row only when the request opts in", async () => {
    const entry = createRunEntry({ endedAt: 4_000, pauseReason: "sessions_yield" });
    const controller = createController(entry);

    await controller.completeSubagentRun(request(entry));
    expect(readLifecycleRun(entry)).toMatchObject({ pauseReason: "sessions_yield" });
    expect(readLifecycleRun(entry).execution.outcome).toBeUndefined();

    await controller.completeSubagentRun(request(entry, { settleYielded: true }));
    expect(readLifecycleRun(entry).pauseReason).toBeUndefined();
    expect(readLifecycleRun(entry).execution.outcome).toMatchObject({
      status: "error",
      error: "no continuation can reach this run",
    });
  });

  it.each([
    { label: "the sweeper's stale snapshot", withSnapshot: true },
    { label: "no snapshot, so only the in-mutation check applies", withSnapshot: false },
  ])(
    "leaves a row that a continuation already resumed untouched ($label)",
    async ({ withSnapshot }) => {
      // The sweeper read the row while it was yielded; a continuation resumed it before the
      // settle request reached the mutation.
      const entry = createRunEntry({ endedAt: 4_000, pauseReason: "sessions_yield" });
      const staleSnapshot = structuredClone(entry);
      const controller = createController(entry);
      await mutateLifecycleRun(entry, (draft) => {
        draft.pauseReason = undefined;
        draft.execution = { status: "running", startedAt: 5_000 };
      });

      await controller.completeSubagentRun({
        ...request(entry, { settleYielded: true }),
        ...(withSnapshot ? { expectedEntry: staleSnapshot } : {}),
      });

      expect(readLifecycleRun(entry).pauseReason).toBeUndefined();
      expect(readLifecycleRun(entry).execution).toMatchObject({
        status: "running",
        startedAt: 5_000,
      });
      expect(readLifecycleRun(entry).execution.outcome).toBeUndefined();
    },
  );

  it("leaves a row that already finished untouched when a settle request arrives late", async () => {
    const entry = createRunEntry({ endedAt: 4_000, outcome: { status: "ok" } });
    const controller = createController(entry);

    await controller.completeSubagentRun(request(entry, { settleYielded: true }));

    expect(readLifecycleRun(entry).execution.outcome).toEqual({ status: "ok" });
  });
});
