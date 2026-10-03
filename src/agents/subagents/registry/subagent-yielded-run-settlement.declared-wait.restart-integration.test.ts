// Real registry, SQLite and sweeper proof that a declared message wait is bounded by its age.
import { afterEach, describe, expect, it, vi } from "vitest";
// Preserve module setup before modules that consume it.
// oxfmt-ignore
import { makeRestartRecoveryRun as makeRunRecord, useSubagentRestartRecoveryFixture } from "./subagent-restart-recovery.test-support.js";
import {
  clearAgentRunContext,
  registerAgentRunContext,
} from "../../../infra/agent-run-registry.js";
import { createRequesterYieldCallback } from "../../openclaw-tools.requester-yield.js";
import { runSubagentAnnounceFlow } from "../announce/subagent-announce.js";
import { subagentRuns } from "./subagent-registry-memory.js";
import { mutateSubagentRuns } from "./subagent-registry-persistence.js";
import { markSubagentRunPausedAfterYield } from "./subagent-registry-run-pause.js";
import { writeSubagentSessionEntry } from "./subagent-registry.persistence.test-support.js";
import { loadSubagentRegistryFromSqlite } from "./subagent-registry.store.sqlite.js";
import {
  addSubagentRunForTests,
  adoptPausedSubagentRunForFollowUp,
  getSubagentRunByChildSessionKey,
  initSubagentRegistry,
  resetSubagentRegistryForTests,
  testing,
} from "./subagent-registry.test-helpers.js";

const T0 = Date.parse("2026-10-03T08:00:00Z");
const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const WAIT_LEAF_KEY = "agent:main:subagent:declared-wait";

describe("declared message wait", () => {
  const fixture = useSubagentRestartRecoveryFixture();

  afterEach(() => {
    vi.useRealTimers();
    clearAgentRunContext("successor-run");
    clearAgentRunContext("declared-wait-run");
  });

  const persisted = (runId: string) => loadSubagentRegistryFromSqlite().get(runId);

  const WAIT_RUN_ID = "declared-wait-run";
  const restartRegistry = async () => {
    await fixture.settle();
    await resetSubagentRegistryForTests({ persist: false });
    await initSubagentRegistry();
    await fixture.activateGatewayRuntime();
  };
  const yieldWithMessageWait = async (cleanup: "keep" | "delete" = "keep") => {
    // The requester and the waiting child both own sessions, so a settled outcome can be announced.
    for (const [sessionKey, sessionId] of [
      ["agent:main:main", "sess-requester"],
      [WAIT_LEAF_KEY, "sess-wait-leaf"],
    ] as const) {
      await writeSubagentSessionEntry({
        stateDir: fixture.stateDir,
        agentId: "main",
        sessionKey,
        sessionId,
        defaultSessionId: sessionId,
      });
    }
    await addSubagentRunForTests(
      makeRunRecord({
        runId: WAIT_RUN_ID,
        childSessionKey: WAIT_LEAF_KEY,
        requesterAgentId: "main",
        expectsCompletionMessage: true,
        cleanup,
        startedAt: T0 - MINUTE_MS,
      }),
    );
    // A live run owns an execution context; without one the sweeper treats it as orphaned.
    registerAgentRunContext(WAIT_RUN_ID, { sessionKey: WAIT_LEAF_KEY });
    // Real admission: the claim a childless leaf's sessions_yield reaches.
    const claim = createRequesterYieldCallback({
      requesterSessionKey: WAIT_LEAF_KEY,
      requesterAgentId: "main",
      requesterTurnRunId: WAIT_RUN_ID,
    });
    expect(
      await claim?.({ waitFor: "message", acknowledgment: "Waiting for the remote job." }),
    ).toEqual({ messageWaitRegistered: true });
    // The runtime publishes the pause through this registry owner once the turn ends.
    await mutateSubagentRuns(
      [WAIT_RUN_ID],
      (rows) => {
        const draft = structuredClone(rows.get(WAIT_RUN_ID)!);
        markSubagentRunPausedAfterYield({ entry: draft, endedAt: Date.now() });
        return { value: undefined, postimages: new Map([[WAIT_RUN_ID, draft]]) };
      },
      { runs: subagentRuns },
    );
    clearAgentRunContext(WAIT_RUN_ID);
  };

  const ANNOUNCED_ERROR = expect.objectContaining({
    childRunId: WAIT_RUN_ID,
    outcome: expect.objectContaining({
      status: "error",
      error: expect.stringContaining("within 24 hours"),
    }),
  });

  it("keeps the pause time across a restart and settles once the age bound passes", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(T0);
    await yieldWithMessageWait();
    const pausedAt = persisted(WAIT_RUN_ID)?.execution.endedAt;
    expect(pausedAt).toBe(T0);

    vi.setSystemTime(T0 + 12 * HOUR_MS);
    await restartRegistry();
    await testing.sweepOnceForTests();
    expect(persisted(WAIT_RUN_ID), "restart and sweep do not rewrite the pause time").toMatchObject(
      { pauseReason: "sessions_yield", execution: { endedAt: pausedAt } },
    );

    vi.setSystemTime(T0 + 24 * HOUR_MS - 1);
    await testing.sweepOnceForTests();
    expect(persisted(WAIT_RUN_ID)?.pauseReason, "held until the bound").toBe("sessions_yield");
    expect(runSubagentAnnounceFlow).not.toHaveBeenCalled();

    vi.setSystemTime(T0 + 24 * HOUR_MS);
    await testing.sweepOnceForTests();
    await fixture.settle();

    const settled = persisted(WAIT_RUN_ID);
    expect(settled?.pauseReason).toBeUndefined();
    expect(settled?.execution).toMatchObject({
      status: "terminal",
      endedAt: pausedAt,
      outcome: { status: "error", error: expect.stringContaining("within 24 hours") },
    });
    // The requester is told through the normal completion announce, carrying the failed outcome.
    expect(vi.mocked(runSubagentAnnounceFlow)).toHaveBeenCalledWith(ANNOUNCED_ERROR);
  });

  it("resumes normally when a continuation arrives after a restart and before the bound", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(T0);
    await yieldWithMessageWait();
    await restartRegistry();

    vi.setSystemTime(T0 + 13 * HOUR_MS);
    expect(
      await adoptPausedSubagentRunForFollowUp({
        childSessionKey: WAIT_LEAF_KEY,
        runId: "successor-run",
        task: "the remote job finished",
      }),
    ).toBe(true);
    registerAgentRunContext("successor-run", { sessionKey: WAIT_LEAF_KEY });
    await fixture.settle();

    vi.setSystemTime(T0 + 25 * HOUR_MS);
    await testing.sweepOnceForTests();
    await fixture.settle();

    const successor = getSubagentRunByChildSessionKey(WAIT_LEAF_KEY);
    expect(successor?.runId).toBe("successor-run");
    expect(successor?.execution.status).toBe("running");
    expect(successor?.execution.outcome).toBeUndefined();
    expect(vi.mocked(runSubagentAnnounceFlow)).not.toHaveBeenCalledWith(ANNOUNCED_ERROR);
  });

  it("announces an expired wait exactly once and leaves cleanup to the run's own policy", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(T0);
    await yieldWithMessageWait("delete");
    vi.setSystemTime(T0 + 24 * HOUR_MS);
    await testing.sweepOnceForTests();
    await testing.sweepOnceForTests();
    await fixture.settle();

    const announces = vi
      .mocked(runSubagentAnnounceFlow)
      .mock.calls.filter(([params]) => params.childRunId === WAIT_RUN_ID);
    expect(announces).toHaveLength(1);
    expect(announces[0]?.[0]).toMatchObject({ cleanup: "delete", outcome: { status: "error" } });
  });

  describe("a continuation and the sweeper at the same instant", () => {
    it("lets the continuation win when it lands first", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(T0);
      await yieldWithMessageWait();
      vi.setSystemTime(T0 + 24 * HOUR_MS);
      expect(
        await adoptPausedSubagentRunForFollowUp({
          childSessionKey: WAIT_LEAF_KEY,
          runId: "successor-run",
          task: "the remote job finished",
        }),
      ).toBe(true);
      registerAgentRunContext("successor-run", { sessionKey: WAIT_LEAF_KEY });
      await testing.sweepOnceForTests();
      await fixture.settle();

      expect(getSubagentRunByChildSessionKey(WAIT_LEAF_KEY)).toMatchObject({
        runId: "successor-run",
        execution: { status: "running" },
      });
      expect(vi.mocked(runSubagentAnnounceFlow)).not.toHaveBeenCalledWith(ANNOUNCED_ERROR);
    });

    it("refuses a late continuation once the sweeper settled the wait", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(T0);
      await yieldWithMessageWait();
      vi.setSystemTime(T0 + 24 * HOUR_MS);
      await testing.sweepOnceForTests();
      await fixture.settle();
      expect(persisted(WAIT_RUN_ID)?.execution.outcome?.status).toBe("error");

      expect(
        await adoptPausedSubagentRunForFollowUp({
          childSessionKey: WAIT_LEAF_KEY,
          runId: "successor-run",
          task: "too late",
        }),
      ).toBe(false);
      expect(persisted(WAIT_RUN_ID)?.execution.outcome?.status).toBe("error");
    });
  });
});
