// Real registry, SQLite and sweeper proof that a yielded run no continuation can reach settles.
import { afterEach, describe, expect, it, vi } from "vitest";
// Preserve module setup before modules that consume it.
// oxfmt-ignore
import { makeRestartRecoveryRun as makeRunRecord, useSubagentRestartRecoveryFixture } from "./subagent-restart-recovery.test-support.js";
import { createAgentsWaitTool } from "../../tools/agents-wait-tool.js";
import { createSubagentsTool } from "../../tools/subagents-tool.js";
import { observeSubagentExecution } from "./subagent-execution-observation.js";
import { subagentRuns } from "./subagent-registry-memory.js";
import { writeSubagentSessionEntry } from "./subagent-registry.persistence.test-support.js";
import { loadSubagentRegistryFromSqlite } from "./subagent-registry.store.sqlite.js";
import {
  addSubagentRunForTests,
  initSubagentRegistry,
  resetSubagentRegistryForTests,
  testing,
} from "./subagent-registry.test-helpers.js";
import type { SubagentRunRecord } from "./subagent-registry.types.js";
import { resolveSubagentDisplayStatus } from "./subagent-session-metrics.js";

type RunView = { runId: string; status: string };

const T0 = Date.parse("2026-10-03T08:00:00Z");
const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const COLLECTOR_KEY = "agent:main:subagent:legacy-collector";

describe("yielded run settlement", () => {
  const fixture = useSubagentRestartRecoveryFixture();

  afterEach(() => {
    vi.useRealTimers();
  });

  const persisted = (runId: string) => loadSubagentRegistryFromSqlite().get(runId);
  const restartRegistry = async () => {
    await fixture.settle();
    await resetSubagentRegistryForTests({ persist: false });
    await initSubagentRegistry();
    await fixture.activateGatewayRuntime();
  };
  const waitSurface = async (runId: string) => {
    const tool = createAgentsWaitTool({ agentSessionKey: "agent:main:main", agentId: "main" });
    const result = await tool.execute("wait", { ids: [runId], timeoutSeconds: 0 });
    return result.details as {
      completed: Array<{ status: string; error?: string }>;
      pending: string[];
    };
  };
  // The pre-fix shapes seen in the field: the yield marker with no collector completion, and the
  // execution outcome either absent (#141474 comment of 9/13) or `ok` (the issue body).
  const LEGACY_SHAPES = [
    { shape: "execution.outcome absent", outcome: undefined },
    { shape: "execution.outcome ok with endedAt", outcome: { status: "ok" as const } },
  ];
  const legacyYieldedCollector = (outcome?: { status: "ok" }) =>
    makeRunRecord({
      runId: "legacy-yielded-collector",
      childSessionKey: COLLECTOR_KEY,
      requesterAgentId: "main",
      collect: true,
      groupId: "group-legacy",
      swarmRequesterSessionKey: "agent:main:main",
      expectsCompletionMessage: false,
      pauseReason: "sessions_yield",
      createdAt: T0 - 5 * MINUTE_MS,
      startedAt: T0 - 5 * MINUTE_MS,
      endedAt: T0 - 4 * MINUTE_MS,
      ...(outcome ? { outcome } : {}),
    });

  it.each(LEGACY_SHAPES)(
    "settles stranded yielded rows on the first sweep after the registry restarts ($shape)",
    async ({ outcome }) => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(T0);
      await writeSubagentSessionEntry({
        stateDir: fixture.stateDir,
        agentId: "main",
        sessionKey: COLLECTOR_KEY,
        sessionId: "sess-legacy-collector",
        defaultSessionId: "sess-legacy-collector",
      });
      // Controls: yielded rows that a continuation can still reach stay untouched.
      const orchestrator = makeRunRecord({
        runId: "yielded-orchestrator",
        childSessionKey: "agent:main:subagent:orchestrator",
        expectsCompletionMessage: true,
        wakeOnDescendantSettle: true,
        pauseReason: "sessions_yield",
        createdAt: T0 - 5 * MINUTE_MS,
        startedAt: T0 - 5 * MINUTE_MS,
        endedAt: T0 - 4 * MINUTE_MS,
      });
      const recentLeaf = makeRunRecord({
        runId: "yielded-recent-leaf",
        childSessionKey: "agent:main:subagent:recent-leaf",
        expectsCompletionMessage: true,
        pauseReason: "sessions_yield",
        createdAt: T0 - 5 * MINUTE_MS,
        startedAt: T0 - 5 * MINUTE_MS,
        endedAt: T0 - 4 * MINUTE_MS,
      });
      // Paused far longer than the bound, yet it owes a wake to a child that is still waiting.
      const awaitingOrchestrator = makeRunRecord({
        runId: "yielded-awaiting-orchestrator",
        childSessionKey: "agent:main:subagent:awaiting-orchestrator",
        expectsCompletionMessage: true,
        pauseReason: "sessions_yield",
        createdAt: T0 - 26 * HOUR_MS,
        startedAt: T0 - 26 * HOUR_MS,
        endedAt: T0 - 25 * HOUR_MS,
      });
      const awaitedChild = makeRunRecord({
        runId: "yielded-awaited-child",
        childSessionKey: "agent:main:subagent:awaited-child",
        requesterSessionKey: awaitingOrchestrator.childSessionKey,
        expectsCompletionMessage: true,
        pauseReason: "sessions_yield",
        createdAt: T0 - 2 * HOUR_MS,
        startedAt: T0 - 2 * HOUR_MS,
        endedAt: T0 - HOUR_MS,
      });
      // The same kind of leaf as `recentLeaf`, paused 25 h before the sweep: the parked rows that no
      // continuation reached within the bound.
      const expiredLeaf = makeRunRecord({
        runId: "yielded-expired-leaf",
        childSessionKey: "agent:main:subagent:expired-leaf",
        expectsCompletionMessage: true,
        pauseReason: "sessions_yield",
        createdAt: T0 - 26 * HOUR_MS,
        startedAt: T0 - 26 * HOUR_MS,
        endedAt: T0 - 25 * HOUR_MS,
      });
      for (const run of [
        legacyYieldedCollector(outcome),
        orchestrator,
        recentLeaf,
        awaitingOrchestrator,
        awaitedChild,
        expiredLeaf,
      ]) {
        await addSubagentRunForTests(run);
      }
      expect(persisted("legacy-yielded-collector")?.execution.outcome?.status).toBe(
        outcome?.status,
      );
      await restartRegistry();
      expect(
        await waitSurface("legacy-yielded-collector"),
        "before the sweep the waiter has no result",
      ).toMatchObject({ completed: [], pending: ["legacy-yielded-collector"] });

      await testing.sweepOnceForTests();
      await fixture.settle();

      const settled = persisted("legacy-yielded-collector");
      expect(settled?.pauseReason).toBeUndefined();
      expect(settled?.execution).toMatchObject({
        status: "terminal",
        outcome: { status: "error", error: expect.stringContaining("Collector yielded") },
      });
      expect(settled?.collectorCompletion?.status).toBe("failed");
      const waited = await waitSurface("legacy-yielded-collector");
      expect(waited.pending).toEqual([]);
      expect(waited.completed).toMatchObject([
        { status: "failed", error: expect.stringContaining("Collector yielded") },
      ]);
      expect(persisted("yielded-expired-leaf")).toMatchObject({
        execution: {
          status: "terminal",
          // The run ended when it yielded; settling must not move that time.
          endedAt: T0 - 25 * HOUR_MS,
          outcome: { status: "error", error: expect.stringContaining("within 24 hours") },
        },
      });
      expect(persisted("yielded-expired-leaf")?.pauseReason).toBeUndefined();
      for (const control of [orchestrator, recentLeaf, awaitingOrchestrator, awaitedChild]) {
        expect(persisted(control.runId), control.runId).toMatchObject({
          pauseReason: "sessions_yield",
          execution: { status: "terminal" },
        });
        expect(persisted(control.runId)?.execution.outcome).toBeUndefined();
      }
    },
  );

  it("never reports a yielded run as done or finished while its waiter pends", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(T0);
    await writeSubagentSessionEntry({
      stateDir: fixture.stateDir,
      agentId: "main",
      sessionKey: COLLECTOR_KEY,
      sessionId: "sess-legacy-collector",
      defaultSessionId: "sess-legacy-collector",
    });
    await addSubagentRunForTests(legacyYieldedCollector());
    const surfaces = async () => {
      const entry = subagentRuns.get("legacy-yielded-collector") as SubagentRunRecord;
      const waiter = await waitSurface("legacy-yielded-collector");
      const listed = (
        await createSubagentsTool({ agentSessionKey: "agent:main:main", agentId: "main" }).execute(
          "list",
          { action: "list" },
        )
      ).details as { active: Array<RunView>; recent: Array<RunView> };
      const active = listed.active.find((run) => run.runId === entry.runId);
      const recent = listed.recent.find((run) => run.runId === entry.runId);
      return {
        display: resolveSubagentDisplayStatus(entry),
        observed: observeSubagentExecution(entry, []).state,
        waiter: waiter.completed.length > 0 ? waiter.completed[0]?.status : "pending",
        list: active ? `active: ${active.status}` : recent ? `recent: ${recent.status}` : "absent",
      };
    };
    // Before settlement every surface answers "not finished".
    expect(await surfaces()).toEqual({
      display: "waiting for external continuation",
      observed: "waiting",
      waiter: "pending",
      list: "active: waiting for external continuation",
    });
    await testing.sweepOnceForTests();
    await fixture.settle();
    // After settlement every surface answers "failed" and none still answers "waiting".
    expect(await surfaces()).toEqual({
      display: "failed",
      observed: "finished",
      waiter: "failed",
      list: "recent: failed",
    });
  });
});
