import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { loadPendingSessionDeliveries } from "../../../infra/session-delivery-queue-storage.js";
import {
  closeOpenClawStateDatabaseAsync,
  closeOpenClawStateDatabaseForTest,
  openOpenClawStateDatabase,
  runOpenClawStateWriteTransaction,
  type OpenClawStateDatabase,
} from "../../../state/openclaw-state-db.js";
import { captureOpenClawStateWorkerContext } from "../../../state/openclaw-state-worker-context.js";
import {
  createOpenClawTestState,
  type OpenClawTestState,
} from "../../../test-utils/openclaw-test-state.js";
import type { SubagentAnnounceDeliveryResult } from "../announce/subagent-announce-dispatch.js";
import { subagentRuns } from "../registry/subagent-registry-memory.js";
import { loadSubagentRegistryFromSqlite } from "../registry/subagent-registry.store.sqlite.js";
import type { SubagentRunRecord } from "../registry/subagent-registry.types.js";
import * as completionStore from "./subagent-completion-admission.store.js";
import {
  admitCompletionFixtureDatabase,
  advanceRequesterWakeTime,
  armRequesterWake,
  failedRecords,
  records,
  reopenCompletionFixtureOwners,
  requesterWakeDriver,
  seedSubagentCompletionDelivery,
  seedSubagentCompletionOwner,
} from "./subagent-completion-admission.test-helpers.js";
import {
  mutateSubagentCompletionInDatabase,
  readRequesterSettleOwnerChangedMessage,
} from "./subagent-completion-mutation.kernel.js";
import type { RequesterWakeQuarantine } from "./subagent-completion-mutation.types.js";

vi.mock("../registry/subagent-registry.js", () => ({ resumeSubagentRun: vi.fn() }));

const RUN_ID = "completion-run";
const DAY = 24 * 60 * 60_000;
// Longer than the 120s backoff ceiling, so every tick admits exactly one retry.
const TICK_MS = 130_000;
const QUARANTINE_AFTER = 5;
const QUARANTINE_WARN = "requester settle wake quarantined";
const SIBLING_ID = "completion-sibling";

type Input = ReturnType<typeof records>;

const undelivered = (overrides: Partial<SubagentAnnounceDeliveryResult> = {}) =>
  ({
    delivered: false,
    path: "none",
    error: "requester session unavailable",
    ...overrides,
  }) as const;

/** Every shape a non-delivered requester settle can carry into completeBatch. */
const UNDELIVERED_OUTCOMES: ReadonlyArray<[string, SubagentAnnounceDeliveryResult]> = [
  ["plain failure", undelivered()],
  ["ambiguous", undelivered({ disposition: "ambiguous", error: "ambiguous transport" })],
  ["permanent_failure", undelivered({ disposition: "permanent_failure", error: "rejected" })],
  [
    "intentional_non_delivery",
    undelivered({
      reason: "completion_handoff_unavailable",
      terminal: true,
      disposition: "intentional_non_delivery",
      error: "private completion requester session was replaced",
    }),
  ],
  [
    "store replaced",
    undelivered({
      storeReplaced: true,
      disposition: "intentional_non_delivery",
      error: "store replaced",
    }),
  ],
  ["requester_abandoned", undelivered({ reason: "requester_abandoned", error: undefined })],
];

describe("requester settle wake quarantine (#154252)", () => {
  let database: OpenClawStateDatabase;
  let testState: OpenClawTestState;

  // One state database for the file: opening and admitting the worker costs about half a
  // second, so each test clears the rows it wrote instead of reopening. The restart test
  // reopens it and runs last.
  beforeAll(async () => {
    testState = await createOpenClawTestState({ scenario: "minimal", applyEnv: true });
    database = openOpenClawStateDatabase();
    await admitCompletionFixtureDatabase();
  });

  afterAll(async () => {
    await closeOpenClawStateDatabaseAsync();
    subagentRuns.clear();
    closeOpenClawStateDatabaseForTest();
    await testState.cleanup();
  });

  beforeEach(() => {
    database.db.exec("DROP TRIGGER IF EXISTS reject_settle");
    database.db.exec("DELETE FROM subagent_runs");
    database.db.exec("DELETE FROM delivery_queue_entries");
    subagentRuns.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const persistOwner = (input: Input) =>
    seedSubagentCompletionOwner({ subagent: input.subagent, databaseOptions: { database } });
  const persisted = (runId = RUN_ID) => loadSubagentRegistryFromSqlite().get(runId);
  /** A write that lands behind the resident copy, as a racing sibling commit would. */
  const rewritePersisted = (mutate: (row: SubagentRunRecord) => void, runId = RUN_ID) => {
    const row = structuredClone(persisted(runId)!);
    mutate(row);
    seedSubagentCompletionDelivery({ subagent: row, databaseOptions: { database } });
  };
  const resetFixtureRows = () => {
    subagentRuns.clear();
    database.db.exec("DELETE FROM subagent_runs");
  };
  const quarantine = (input: Input, overrides: Partial<RequesterWakeQuarantine> = {}) =>
    completionStore.quarantineRequesterSettleWake({
      entries: [input.subagent],
      quarantine: { reason: "quarantined for test", ...overrides },
      context: captureOpenClawStateWorkerContext(),
    });
  const quarantineInKernel = (input: Input, overrides: Partial<RequesterWakeQuarantine> = {}) =>
    runOpenClawStateWriteTransaction(
      (db) =>
        mutateSubagentCompletionInDatabase(db, {
          kind: "quarantineWake",
          entries: [{ subagent: input.subagent }],
          quarantine: { reason: "quarantined for test", ...overrides },
          now: Date.now(),
        }),
      { database, path: database.path },
    );
  const settleOrdinary = (input: Input, outcome: SubagentAnnounceDeliveryResult) =>
    completionStore.settleRequesterCompletionBatch({
      entries: [{ subagent: input.subagent }],
      outcome,
      isCurrent: () => true,
      databaseOptions: { database },
    });

  /** The delivery decision a settle recorded, without run-specific text. */
  const shape = (runId = RUN_ID) => {
    const row = persisted(runId);
    const delivery = row?.delivery;
    return {
      present: row !== undefined,
      status: delivery?.status,
      disposition: delivery?.disposition,
      suspendedReason: delivery?.suspendedReason,
      lastDropReason: delivery?.lastDropReason,
      payload: delivery?.payload !== undefined,
      wake: row?.requesterSettleWake,
      suppressed: row?.suppressCompletionDelivery,
    };
  };
  const systemEventTexts = async () =>
    (await loadPendingSessionDeliveries(captureOpenClawStateWorkerContext()))
      .filter((entry) => entry.kind === "systemEvent")
      .map((entry) => (entry as { text: string }).text);

  describe("mutation", () => {
    it.each(UNDELIVERED_OUTCOMES)(
      "records %s exactly as ordinary settlement does",
      async (_label, outcome) => {
        const ordinary = failedRecords("failed", { status: "error", error: "child failed" });
        persistOwner(ordinary);
        await settleOrdinary(ordinary, outcome);
        const expected = shape();
        expect(expected.wake).toBeUndefined();
        expect(expected.present).toBe(true);
        resetFixtureRows();

        const input = failedRecords("failed", { status: "error", error: "child failed" });
        persistOwner(input);
        await expect(
          quarantine(input, {
            disposition: outcome.disposition,
            storeReplaced: outcome.storeReplaced,
          }),
        ).resolves.toEqual({ applied: true, publication: "published" });

        expect(shape()).toEqual(expected);
      },
    );

    it("keeps the failed delivery's payload and reason for a deliverable row", async () => {
      const input = failedRecords("failed", { status: "error", error: "child failed" });
      persistOwner(input);
      await quarantine(input, { reason: "quarantined after 5; last delivery error: boom" });
      expect(persisted()?.delivery).toMatchObject({
        status: "failed",
        lastError: "quarantined after 5; last delivery error: boom",
        payload: expect.objectContaining({ childRunId: RUN_ID }),
      });
      expect(persisted()?.completion?.resultText).toBe("original failure summary");
    });

    it("queues the blocked-delivery system event for a successful child, as ordinary blocking does", async () => {
      const input = armRequesterWake(records());
      persistOwner(input);
      expect(input.subagent.execution.outcome?.status).toBe("ok");
      await quarantine(input, { reason: "quarantined for test" });
      expect(persisted()?.delivery).toMatchObject({ status: "failed" });
      expect(await systemEventTexts()).toEqual([
        "Subagent completion delivery is blocked: quarantined for test",
      ]);
      // The same row blocked through the ordinary settle path queues the identical text.
      resetFixtureRows();
      const ordinary = armRequesterWake(records());
      persistOwner(ordinary);
      await settleOrdinary(ordinary, undelivered({ error: "quarantined for test" }));
      expect(
        (await systemEventTexts()).every((text) => text.endsWith("quarantined for test")),
      ).toBe(true);
    });

    it("suspends a failed child the blocked-completion owner can never record, with no event, as ordinary blocking queues none for a failed child", async () => {
      const input = failedRecords("cancelled", { status: "error", error: "killed by operator" });
      input.subagent.generation = 1;
      input.subagent.execution.endedAt = Date.now() - 8 * DAY;
      input.subagent.delivery = { status: "pending" };
      input.subagent.cleanupCompletedAt = Date.now() - 8 * DAY;
      persistOwner(input);
      const newer = records();
      newer.subagent.runId = "completion-newer";
      newer.subagent.taskRunId = "newer-task";
      newer.subagent.generation = 2;
      newer.subagent.requesterSettleWake = undefined;
      newer.subagent.delivery = { status: "delivered", disposition: "delivered" };
      persistOwner(newer);

      await quarantine(input);

      expect(shape()).toMatchObject({
        status: "suspended",
        disposition: "permanent_failure",
        suspendedReason: "permanent_failure",
        lastDropReason: "sink_unavailable",
        wake: undefined,
      });
      expect(persisted()?.delivery?.lastError).toBe("quarantined for test");
      expect(shape("completion-newer").status).toBe("delivered");
      expect(await systemEventTexts()).toEqual([]);
    });

    it("tells the requester when a successful child's result is suspended instead of recorded", async () => {
      const input = armRequesterWake(records());
      // The blocked-completion owner only records a terminal run, so this row is forced.
      input.subagent.execution.status = "running";
      persistOwner(input);
      expect(input.subagent.execution.outcome?.status).toBe("ok");

      await quarantine(input, { reason: "quarantined for test" });

      expect(shape()).toMatchObject({
        status: "suspended",
        suspendedReason: "permanent_failure",
        lastDropReason: "sink_unavailable",
        wake: undefined,
      });
      expect(await systemEventTexts()).toEqual([
        "Subagent completion delivery is blocked: quarantined for test",
      ]);
    });

    it("refuses a row whose delivery generation moved on, leaving it and its new payload untouched", async () => {
      const input = failedRecords("failed", { status: "error", error: "child failed" });
      persistOwner(input);
      rewritePersisted((row) => (row.delivery!.generation = 2));
      expect(() =>
        runOpenClawStateWriteTransaction(
          (db) =>
            mutateSubagentCompletionInDatabase(db, {
              kind: "requesterBatch",
              entries: [{ subagent: input.subagent }],
              outcome: undelivered(),
              now: Date.now(),
            }),
          { database, path: database.path },
        ),
      ).toThrow(`subagent completion owner changed before settlement: ${RUN_ID}`);
      const before = structuredClone(persisted());

      expect(() => quarantineInKernel(input)).toThrow(
        `subagent completion owner changed before quarantine: ${RUN_ID}`,
      );

      expect(persisted()).toEqual(before);
      expect(persisted()?.delivery).toMatchObject({ generation: 2, status: "in_progress" });
      expect(persisted()?.requesterSettleWake).toBeDefined();
      expect(await systemEventTexts()).toEqual([]);
    });

    it("never touches a paused sessions_yield row", async () => {
      const input = failedRecords("failed", { status: "error", error: "child failed" });
      input.subagent.pauseReason = "sessions_yield";
      persistOwner(input);
      expect(() => quarantineInKernel(input)).toThrow(/owner changed before quarantine/);
      expect(persisted()?.requesterSettleWake).toBeDefined();
      expect(persisted()?.delivery?.status).toBe("in_progress");
    });

    it("keeps the record of a delete-cleanup row that ordinary settlement would retire", async () => {
      const ordinary = failedRecords("failed", { status: "error", error: "child failed" });
      ordinary.subagent.requesterSettleWake!.retireAfterSettle = true;
      persistOwner(ordinary);
      await settleOrdinary(ordinary, undelivered());
      expect(persisted()).toBeUndefined();
      resetFixtureRows();

      const input = failedRecords("failed", { status: "error", error: "child failed" });
      input.subagent.requesterSettleWake!.retireAfterSettle = true;
      persistOwner(input);
      await quarantine(input);
      expect(persisted()).toBeDefined();
      expect(persisted()?.requesterSettleWake).toBeUndefined();
    });

    it("does not defer a retirement behind a running requester turn either", async () => {
      const input = failedRecords("failed", { status: "error", error: "child failed" });
      input.subagent.requesterTurnRunId = "requester-turn";
      input.subagent.requesterSettleWake!.retireAfterSettle = true;
      persistOwner(input);
      await quarantine(input);
      expect(persisted()?.requesterTurnRunId).toBe("requester-turn");
      expect(persisted()?.retireAfterRequesterTurn).toBeUndefined();
      expect(persisted()?.requesterSettleWake).toBeUndefined();
    });

    describe("owner identity", () => {
      const cases: Array<[string, (row: SubagentRunRecord) => void]> = [
        ["re-armed", (row) => (row.requesterSettleWake!.rearmGeneration = 2)],
        ["cohort changed", (row) => (row.requesterSettleWake!.batchRunIds = [row.runId, "other"])],
        ["wake already cleared", (row) => (row.requesterSettleWake = undefined)],
        ["requester session changed", (row) => (row.requesterSessionKey = "agent:main:other")],
        ["requester agent changed", (row) => (row.requesterAgentId = "research")],
        ["run generation changed", (row) => (row.generation = 7)],
      ];

      it.each(cases)(
        "refuses a row that is %s after the resident check, leaving it untouched",
        async (_label, mutate) => {
          const input = failedRecords("failed", { status: "error", error: "child failed" });
          persistOwner(input);
          rewritePersisted(mutate);
          const before = structuredClone(persisted());

          expect(() => quarantineInKernel(input)).toThrow(
            `subagent completion owner changed before quarantine: ${RUN_ID}`,
          );
          expect(persisted()).toEqual(before);
          expect(await systemEventTexts()).toEqual([]);
        },
      );

      it("does not clear a deliverable wake a re-arm committed behind the worker check", async () => {
        const input = failedRecords("failed", { status: "error", error: "child failed" });
        persistOwner(input);
        rewritePersisted((row) => {
          row.requesterSettleWake = { ...row.requesterSettleWake!, rearmGeneration: 2 };
        });

        await expect(quarantine(input)).rejects.toThrow(/changed before (quarantine|mutation)/);

        expect(persisted()?.requesterSettleWake?.rearmGeneration).toBe(2);
        expect(persisted()?.delivery?.status).toBe("in_progress");
      });
    });
  });

  describe("lifecycle controller", () => {
    /** The wake driver completes with `outcome` on each attempt, through the real controller. */
    const startWake = async (input: Input, outcome: SubagentAnnounceDeliveryResult | undefined) => {
      const driver = requesterWakeDriver([input]);
      driver.wake.mockImplementation(async (params) => {
        await params.completeBatch([input.subagent], 1, outcome);
        return true;
      });
      await driver.run();
      return driver;
    };
    const observeStore = () => {
      const errors: unknown[] = [];
      const wrap = (
        name:
          | "settleRequesterCompletionBatch"
          | "mutateRequesterSettleWakeBatch"
          | "quarantineRequesterSettleWake",
      ) => {
        const original = completionStore[name] as (params: unknown) => Promise<unknown>;
        return vi.spyOn(completionStore, name).mockImplementation((async (params: unknown) => {
          try {
            return await original(params);
          } catch (error) {
            errors.push(error);
            throw error;
          }
        }) as never);
      };
      return {
        errors,
        settle: wrap("settleRequesterCompletionBatch"),
        complete: wrap("mutateRequesterSettleWakeBatch"),
        quarantine: wrap("quarantineRequesterSettleWake"),
      };
    };
    const tick = async (count = 1) => {
      for (let i = 0; i < count; i += 1) {
        await advanceRequesterWakeTime(TICK_MS);
      }
    };
    /**
     * Synchronize on the state an attempt produces: how many retries one tick admits depends
     * on when the real worker's reply lands against the fake clock, so a tick count is not a
     * contract.
     */
    const tickUntil = async (done: () => boolean, cap = 40) => {
      for (let i = 0; i < cap && !done(); i += 1) {
        await tick();
      }
      expect(done()).toBe(true);
    };
    const quarantineWarns = (driver: { warn: ReturnType<typeof vi.fn> }) =>
      driver.warn.mock.calls.filter(([message]) => message === QUARANTINE_WARN);
    /**
     * A frozen cohort member that exists only in SQLite: the resident check passes, and the
     * worker's whole-wave read rejects owner-changed on every attempt.
     */
    const strandCohortMember = (input: Input) => {
      const ids = [RUN_ID, SIBLING_ID];
      input.subagent.requesterSettleWake!.batchRunIds = ids;
      const sibling = armRequesterWake(records(), ids);
      Object.assign(sibling.subagent, {
        runId: SIBLING_ID,
        taskRunId: "sibling-task",
        childSessionKey: "agent:main:subagent:sibling",
      });
      seedSubagentCompletionDelivery({ subagent: input.subagent, databaseOptions: { database } });
      seedSubagentCompletionDelivery({ subagent: sibling.subagent, databaseOptions: { database } });
    };
    const fakeTimers = () => vi.useFakeTimers({ toNotFake: ["hrtime", "performance"] });

    it("quarantines after five real owner-changed rejections and stays quiet afterwards", async () => {
      fakeTimers();
      const input = failedRecords("failed", { status: "error", error: "child failed" });
      persistOwner(input);
      strandCohortMember(input);
      const store = observeStore();
      const driver = await startWake(input, undelivered());
      try {
        await tickUntil(() => store.quarantine.mock.calls.length > 0);

        expect(store.settle).toHaveBeenCalledTimes(QUARANTINE_AFTER);
        expect(store.quarantine).toHaveBeenCalledOnce();
        expect(store.errors).toHaveLength(QUARANTINE_AFTER);
        for (const error of store.errors) {
          // The real worker error crosses the queued-write wrapper; the cause chain still finds it.
          expect((error as Error).message).toMatch(
            /^Queued subagent registry persistence failed: subagent completion owner changed before settlement: completion-run$/,
          );
          expect(readRequesterSettleOwnerChangedMessage(error)).toBe(
            `subagent completion owner changed before settlement: ${RUN_ID}`,
          );
        }
        expect(quarantineWarns(driver)).toEqual([
          [
            QUARANTINE_WARN,
            {
              signature: "subagent completion owner changed before settlement",
              failures: QUARANTINE_AFTER,
              runIds: ["comp…-run"],
            },
          ],
        ]);
        expect(persisted()?.requesterSettleWake).toBeUndefined();
        expect(persisted()?.delivery).toMatchObject({
          status: "failed",
          payload: expect.objectContaining({ childRunId: RUN_ID }),
          lastError: expect.stringContaining("quarantined after 5 identical settlement failures"),
        });
        expect(persisted()?.delivery?.lastError).toContain(
          "last delivery error: requester session unavailable",
        );

        await tick(10);
        expect(store.settle).toHaveBeenCalledTimes(QUARANTINE_AFTER);
        expect(store.quarantine).toHaveBeenCalledOnce();
      } finally {
        driver.controller.clearScheduledResumeTimers();
      }
    });

    it.each(UNDELIVERED_OUTCOMES)(
      "carries the %s disposition through the lifecycle quarantine",
      async (_label, outcome) => {
        const ordinary = failedRecords("failed", { status: "error", error: "child failed" });
        persistOwner(ordinary);
        await settleOrdinary(ordinary, outcome);
        const expected = shape();
        resetFixtureRows();

        fakeTimers();
        const input = failedRecords("failed", { status: "error", error: "child failed" });
        persistOwner(input);
        strandCohortMember(input);
        const driver = await startWake(input, outcome);
        try {
          await tickUntil(() => quarantineWarns(driver).length > 0);
          expect(quarantineWarns(driver)).toHaveLength(1);
          expect(shape()).toEqual(expected);
        } finally {
          driver.controller.clearScheduledResumeTimers();
        }
      },
    );

    it("settles a wake with no outcome in one attempt on the stranded cohort, so it needs no bound", async () => {
      fakeTimers();
      const input = failedRecords("failed", { status: "error", error: "child failed" });
      persistOwner(input);
      strandCohortMember(input);
      const deliveryBefore = structuredClone(persisted()?.delivery);
      const store = observeStore();
      const driver = await startWake(input, undefined);
      try {
        await tickUntil(() => persisted()?.requesterSettleWake === undefined);

        expect(store.complete).toHaveBeenCalledOnce();
        expect(store.errors).toEqual([]);
        expect(store.quarantine).not.toHaveBeenCalled();
        expect(persisted()?.requesterSettleWake).toBeUndefined();
        expect(persisted()?.delivery).toEqual(deliveryBefore);
      } finally {
        driver.controller.clearScheduledResumeTimers();
      }
    });

    it("ends a wake with no outcome at the resident check when the persisted row diverges, without looping", async () => {
      fakeTimers();
      const input = failedRecords("failed", { status: "error", error: "child failed" });
      persistOwner(input);
      rewritePersisted((row) => (row.requesterSettleWake!.batchRunIds = [row.runId, "ghost"]));
      const store = observeStore();
      const driver = await startWake(input, undefined);
      try {
        await tick(10);

        expect(store.complete.mock.calls.length).toBeLessThan(QUARANTINE_AFTER);
        for (const error of store.errors) {
          expect(readRequesterSettleOwnerChangedMessage(error)).toBeUndefined();
        }
        expect(store.quarantine).not.toHaveBeenCalled();
        expect(persisted()?.requesterSettleWake).toBeDefined();
      } finally {
        driver.controller.clearScheduledResumeTimers();
      }
    });

    it("never quarantines a delivered outcome, however long owner-changed repeats, and settles once the rows agree", async () => {
      fakeTimers();
      const input = failedRecords("failed", { status: "error", error: "child failed" });
      persistOwner(input);
      strandCohortMember(input);
      const store = observeStore();
      const driver = await startWake(input, { delivered: true, path: "direct" });
      try {
        await tickUntil(() => store.settle.mock.calls.length > QUARANTINE_AFTER * 2);

        expect(store.settle.mock.calls.length).toBeGreaterThan(QUARANTINE_AFTER * 2);
        expect(store.quarantine).not.toHaveBeenCalled();
        expect(quarantineWarns(driver)).toEqual([]);
        expect(persisted()?.requesterSettleWake).toBeDefined();
        expect(persisted()?.delivery?.status).toBe("in_progress");

        rewritePersisted((row) => (row.requesterSettleWake = undefined), SIBLING_ID);
        await tickUntil(() => persisted()?.requesterSettleWake === undefined);
        expect(persisted()?.delivery?.status).toBe("delivered");
      } finally {
        driver.controller.clearScheduledResumeTimers();
      }
    });

    it("never counts a real wrapped SQLite error, and settles when the store recovers", async () => {
      fakeTimers();
      const input = failedRecords("failed", { status: "error", error: "child failed" });
      persistOwner(input);
      database.db.exec(
        "CREATE TRIGGER reject_settle BEFORE UPDATE ON subagent_runs BEGIN SELECT RAISE(ABORT, 'cut:settle'); END",
      );
      const store = observeStore();
      const driver = await startWake(input, undelivered());
      try {
        await tickUntil(() => store.settle.mock.calls.length > QUARANTINE_AFTER);

        expect(store.settle.mock.calls.length).toBeGreaterThan(QUARANTINE_AFTER);
        expect(store.errors.length).toBe(store.settle.mock.calls.length);
        for (const error of store.errors) {
          expect((error as Error).message).toContain("cut:settle");
          expect(readRequesterSettleOwnerChangedMessage(error)).toBeUndefined();
        }
        expect(store.quarantine).not.toHaveBeenCalled();
        expect(quarantineWarns(driver)).toEqual([]);
        expect(persisted()?.requesterSettleWake).toBeDefined();

        database.db.exec("DROP TRIGGER reject_settle");
        await tickUntil(() => persisted()?.requesterSettleWake === undefined);
        expect(persisted()?.delivery?.status).toBe("failed");
        expect(store.quarantine).not.toHaveBeenCalled();
      } finally {
        driver.controller.clearScheduledResumeTimers();
      }
    });

    it("restarts the count with a restart: bounded again, nothing dropped before it ends", async () => {
      fakeTimers();
      const input = failedRecords("failed", { status: "error", error: "child failed" });
      // No terminal outcome: the blocked-completion owner can never record this row.
      input.subagent.execution.outcome = undefined;
      persistOwner(input);
      const store = observeStore();
      let driver = await startWake(input, undelivered());
      try {
        await tickUntil(() => store.settle.mock.calls.length >= 3);
        const attemptsBeforeRestart = store.settle.mock.calls.length;
        expect(attemptsBeforeRestart).toBeLessThan(QUARANTINE_AFTER);
        expect(store.quarantine).not.toHaveBeenCalled();
        driver.controller.clearScheduledResumeTimers();

        // A gateway restart: the in-memory episode is gone, the row is reloaded from SQLite.
        database = await reopenCompletionFixtureOwners();
        const reloaded = subagentRuns.get(RUN_ID)!;
        expect(reloaded.requesterSettleWake).toBeDefined();
        driver = requesterWakeDriver([{ ...input, subagent: reloaded }]);
        driver.wake.mockImplementation(async (params) => {
          await params.completeBatch([reloaded], 1, undelivered());
          return true;
        });
        await driver.run(reloaded);
        await tickUntil(() => store.quarantine.mock.calls.length > 0);

        // The new episode counted from one: the row survived until its own fifth failure.
        expect(store.settle.mock.calls.length - attemptsBeforeRestart).toBe(QUARANTINE_AFTER);
        expect(store.quarantine).toHaveBeenCalledOnce();
        expect(quarantineWarns(driver)).toHaveLength(1);
        expect(persisted()?.requesterSettleWake).toBeUndefined();
        expect(persisted()?.delivery).toMatchObject({
          status: "suspended",
          suspendedReason: "permanent_failure",
        });
        const attemptsAfterQuarantine = store.settle.mock.calls.length;
        await tick(10);
        expect(store.settle).toHaveBeenCalledTimes(attemptsAfterQuarantine);
      } finally {
        driver.controller.clearScheduledResumeTimers();
      }
    });
  });
});
