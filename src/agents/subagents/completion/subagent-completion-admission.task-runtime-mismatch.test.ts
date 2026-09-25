import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { useAutoCleanupTempDirTracker } from "../../../../test/helpers/temp-dir.js";
import { resolvePreferredOpenClawTmpDir } from "../../../infra/tmp-openclaw-dir.js";
import { flushLogger, getLogger, resetLogger, setLoggerOverride } from "../../../logging/logger.js";
import { getActiveGatewayRootWorkCount } from "../../../process/gateway-work-admission.js";
import {
  closeOpenClawStateDatabaseForTest,
  openOpenClawStateDatabase,
  type OpenClawStateDatabase,
} from "../../../state/openclaw-state-db.js";
import { ensureTaskRegistryReady } from "../../../tasks/runtime-internal.js";
import {
  bindTaskRecord,
  findTaskRecordByRunIdForViewInDatabase,
  upsertTaskRunRowInDatabase,
} from "../../../tasks/task-registry.store.kernel.js";
import type { TaskRecord, TaskRuntime } from "../../../tasks/task-registry.types.js";
import { resetTaskRegistryForTests } from "../../../tasks/task-runtime.test-helpers.js";
import type { SubagentAnnounceDeliveryResult } from "../announce/subagent-announce-dispatch.js";
import { SUBAGENT_ENDED_REASON_COMPLETE } from "../registry/subagent-lifecycle-events.js";
import { subagentRuns } from "../registry/subagent-registry-memory.js";
import { loadSubagentRegistryFromSqlite } from "../registry/subagent-registry.store.sqlite.js";
import {
  blockSubagentCompletionDelivery,
  settleSubagentCompletionDelivery,
} from "./subagent-completion-admission.store.js";
import {
  armRequesterWake,
  productionSubagentTaskResolver,
  records,
  requesterWakeDriver,
} from "./subagent-completion-admission.test-helpers.js";

const tempDirs = useAutoCleanupTempDirTracker(afterAll);
vi.mock("../registry/subagent-registry.js", () => ({ resumeSubagentRun: vi.fn() }));

/**
 * Run ids are not unique across task runtimes, so a requester-settle wake can
 * resolve a row this completion does not own. That owner can never become a
 * subagent row, so settlement must terminalize once instead of re-arming.
 *
 * A run id is also not unique, and the shared run-id view returns only its preferred
 * row, so an older foreign row can be selected ahead of a live subagent row. These
 * cases drive the production resolver so both halves are covered: the resolver has to
 * find the row it asked for by runtime and deliver, and the settlement transaction has
 * to refuse retirement on its own when handed a foreign row.
 */
describe("foreign-runtime subagent completion owners", () => {
  let database: OpenClawStateDatabase;
  const warnings = vi.fn();
  let detach: () => void;
  beforeAll(() => {
    const logDir = tempDirs.make("openclaw-completion-logs-", resolvePreferredOpenClawTmpDir());
    setLoggerOverride({
      level: "warn",
      consoleLevel: "silent",
      file: join(logDir, "warnings.log"),
    });
    detach = getLogger().attachTransport(warnings);
  });
  afterAll(() => {
    detach();
    resetLogger();
  });
  beforeEach(() => {
    warnings.mockClear();
    vi.useFakeTimers();
    const tempDir = tempDirs.make("openclaw-foreign-completion-", resolvePreferredOpenClawTmpDir());
    vi.stubEnv("OPENCLAW_STATE_DIR", tempDir);
    database = openOpenClawStateDatabase();
  });
  afterEach(async () => {
    await flushLogger();
    subagentRuns.clear();
    resetTaskRegistryForTests({ persist: false });
    closeOpenClawStateDatabaseForTest();
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  function reopenOwners() {
    closeOpenClawStateDatabaseForTest();
    subagentRuns.clear();
    resetTaskRegistryForTests({ persist: false });
    database = openOpenClawStateDatabase();
    for (const [runId, entry] of loadSubagentRegistryFromSqlite()) {
      subagentRuns.set(runId, entry);
    }
    ensureTaskRegistryReady();
  }

  const readOwnerRow = (taskId = "task-completion") =>
    database.db
      .prepare("SELECT runtime, status, delivery_status FROM task_runs WHERE task_id = ?")
      .get(taskId);

  /** Persists the arrived completion so later sweeps read it back out of SQLite. */
  function persistArrivedCompletion() {
    const input = records();
    input.subagent.endedReason = SUBAGENT_ENDED_REASON_COMPLETE;
    input.subagent.delivery = { status: "pending", deadlineAt: Date.now() + 600_000 };
    armRequesterWake(input);
    settleSubagentCompletionDelivery({ ...input, databaseOptions: { database } });
    return input;
  }

  /**
   * Adds a second task row that shares the completion's run id. Only `cli` is
   * deprioritized by the run-id comparator, so an earlier `cron`/`acp` row is
   * selected ahead of the live subagent row that the completion actually owns.
   */
  function addCollidingForeignTaskRow(task: TaskRecord, runtime: TaskRuntime) {
    const foreign: TaskRecord = {
      ...task,
      taskId: `task-${runtime}-collision`,
      runtime,
      status: "succeeded",
      createdAt: task.createdAt - 60_000,
    };
    upsertTaskRunRowInDatabase(database, bindTaskRecord(foreign));
    return foreign;
  }

  /** The run id settlement reads ownership from, exactly as the production path derives it. */
  const ownerRunId = (input: ReturnType<typeof records>) =>
    input.subagent.taskRunId ?? input.subagent.runId;

  /** Drives one requester-settle sweep through the production resolver. */
  async function sweepRequesterWake(
    input: ReturnType<typeof records>,
    outcome: SubagentAnnounceDeliveryResult,
  ) {
    const driver = requesterWakeDriver([input], {
      resolveSubagentTask: productionSubagentTaskResolver,
    });
    driver.controller.options.callGateway = vi.fn().mockResolvedValue({ messages: [] });
    driver.wake.mockImplementation(async (params) => {
      params.completeBatch([input.subagent], 1, outcome);
      return outcome.delivered === true;
    });
    try {
      driver.controller.resumeRequesterSettleWake(input.subagent.runId, input.subagent, "restore");
      await vi.advanceTimersByTimeAsync(300_000);
      expect(getActiveGatewayRootWorkCount()).toBe(0);
      return driver;
    } finally {
      driver.controller.clearScheduledResumeTimers();
    }
  }

  /** The requester refused this delivery, which is what arms the retirement path. */
  const sweepUndeliveredRequesterWake = (input: ReturnType<typeof records>) =>
    sweepRequesterWake(input, {
      delivered: false,
      path: "none",
      error: "requester unavailable",
    });

  /** The requester accepted this delivery, so a resolvable owner must settle it. */
  const sweepDeliveredRequesterWake = (input: ReturnType<typeof records>) =>
    sweepRequesterWake(input, {
      delivered: true,
      requesterVisibleFinalDelivered: true,
      path: "direct",
    });

  it.each(["cli", "cron", "acp"] as const)(
    "settles an undelivered requester wake once when its only task owner is runtime=%s",
    async (runtime) => {
      const input = persistArrivedCompletion();
      // Reproduces the reported shape: a succeeded child whose persisted ledger row
      // belongs to another runtime, so the subagent owner lookup never matches.
      database.db
        .prepare("UPDATE task_runs SET runtime = ? WHERE task_id = ?")
        .run(runtime, input.task.taskId);
      const ownerRowBefore = readOwnerRow();
      reopenOwners();
      input.subagent = subagentRuns.get(input.subagent.runId)!;
      const completion = structuredClone(input.subagent.completion);

      const driver = await sweepUndeliveredRequesterWake(input);
      expect(driver.wake).toHaveBeenCalledOnce();

      const settled = loadSubagentRegistryFromSqlite().get(input.subagent.runId)!;
      expect(settled.delivery).toMatchObject({
        status: "discarded",
        disposition: "permanent_failure",
        discardReason: "task-missing",
        // The reason names the runtime holding the id. The production resolver
        // filters that row out, so only a run-id owner read can report it.
        lastError: `task-owner-runtime-mismatch:${runtime}`,
        discardedAt: expect.any(Number),
      });
      // The child result survives; only its delivery is terminalized.
      expect(settled.completion).toEqual(completion);
      expect(settled.requesterSettleWake).toBeUndefined();
      // Settlement never reaches into a row owned by another runtime.
      expect(readOwnerRow()).toEqual(ownerRowBefore);

      reopenOwners();
      input.subagent = subagentRuns.get(input.subagent.runId)!;
      const restarted = await sweepUndeliveredRequesterWake(input);
      // A second sweep after restart neither re-enters the wake nor warns again.
      expect(restarted.wake).not.toHaveBeenCalled();
      expect(loadSubagentRegistryFromSqlite().get(input.subagent.runId)).toEqual(input.subagent);
      // One retirement notice across both sweeps is the whole point: the first
      // settlement is terminal, so the sweeper never speaks about this run again.
      expect(warnings).toHaveBeenCalledOnce();
      expect(JSON.stringify(warnings.mock.calls[0])).toContain(input.subagent.runId);
      expect(JSON.stringify(warnings.mock.calls[0])).toContain("task-missing");
      // The operator-visible line names the runtime holding the run id, not just the
      // stable disposition, so the journal explains why this result was dropped.
      expect(JSON.stringify(warnings.mock.calls[0])).toContain(
        `task-owner-runtime-mismatch:${runtime}`,
      );
    },
  );

  it.each(["cron", "acp"] as const)(
    "delivers a completion whose subagent owner sits behind an older runtime=%s row",
    async (runtime) => {
      const input = persistArrivedCompletion();
      const foreign = addCollidingForeignTaskRow(input.task, runtime);
      const foreignRowBefore = readOwnerRow(foreign.taskId);
      reopenOwners();
      input.subagent = subagentRuns.get(input.subagent.runId)!;
      const completion = structuredClone(input.subagent.completion);

      // The collision is real: the shared run-id view prefers the older foreign row
      // even though the subagent row this completion owns is still present.
      expect(findTaskRecordByRunIdForViewInDatabase(database.db, ownerRunId(input))).toMatchObject({
        taskId: foreign.taskId,
        runtime,
      });
      // The production resolver asked for runtime=subagent, so it has to return that
      // row rather than reject whichever row the shared preference happened to pick.
      expect(productionSubagentTaskResolver(input.subagent)).toMatchObject({
        lookup: "available",
        task: { taskId: input.task.taskId, runtime: "subagent" },
      });

      const driver = await sweepDeliveredRequesterWake(input);
      expect(driver.wake).toHaveBeenCalledOnce();

      // The result reaches the requester. A resolver blinded by the collision would
      // instead route this into the taskless path and never deliver it at all.
      const settled = loadSubagentRegistryFromSqlite().get(input.subagent.runId)!;
      expect(settled.delivery).toMatchObject({
        status: "delivered",
        disposition: "delivered",
        deliveredAt: expect.any(Number),
      });
      expect(settled.delivery?.discardReason).toBeUndefined();
      expect(settled.suppressCompletionDelivery).toBeUndefined();
      expect(settled.completion).toEqual(completion);
      expect(settled.requesterSettleWake).toBeUndefined();
      // The owned row records the delivery; the foreign row is never touched.
      expect(readOwnerRow()).toMatchObject({ runtime: "subagent", delivery_status: "delivered" });
      expect(readOwnerRow(foreign.taskId)).toEqual(foreignRowBefore);
    },
  );

  it.each(["cron", "acp"] as const)(
    "refuses retirement when a subagent owner survives behind an older runtime=%s row",
    (runtime) => {
      const input = persistArrivedCompletion();
      const foreign = addCollidingForeignTaskRow(input.task, runtime);
      const ownerRowBefore = readOwnerRow();
      const foreignRowBefore = readOwnerRow(foreign.taskId);
      reopenOwners();
      input.subagent = subagentRuns.get(input.subagent.runId)!;
      const armedWake = structuredClone(input.subagent.requesterSettleWake);
      const completion = structuredClone(input.subagent.completion);

      // Ask settlement to retire this completion against the foreign row directly,
      // which is the shape a blinded caller produces. The transactional fence has to
      // refuse on its own, without relying on the resolver having been fixed.
      expect(
        blockSubagentCompletionDelivery({
          subagent: input.subagent,
          taskId: foreign.taskId,
          reason: "requester unavailable",
          databaseOptions: { database },
        }),
      ).toBe(false);

      // Nothing was retired, so the result is still deliverable on the next sweep.
      const settled = loadSubagentRegistryFromSqlite().get(input.subagent.runId)!;
      expect(settled.delivery).toMatchObject({ status: "pending" });
      expect(settled.delivery?.discardReason).toBeUndefined();
      expect(settled.delivery?.discardedAt).toBeUndefined();
      expect(settled.suppressCompletionDelivery).toBeUndefined();
      expect(settled.completion).toEqual(completion);
      expect(settled.requesterSettleWake).toEqual(armedWake);
      // Neither ledger row is touched by a refused settlement.
      expect(readOwnerRow()).toEqual(ownerRowBefore);
      expect(readOwnerRow(foreign.taskId)).toEqual(foreignRowBefore);
      expect(warnings).not.toHaveBeenCalled();
    },
  );

  it("settles an undelivered requester wake once when no task row owns its run id", async () => {
    const input = persistArrivedCompletion();
    database.db.prepare("DELETE FROM task_runs WHERE run_id = ?").run(ownerRunId(input));
    reopenOwners();
    input.subagent = subagentRuns.get(input.subagent.runId)!;
    const completion = structuredClone(input.subagent.completion);
    expect(findTaskRecordByRunIdForViewInDatabase(database.db, ownerRunId(input))).toBeUndefined();

    const driver = await sweepUndeliveredRequesterWake(input);
    expect(driver.wake).toHaveBeenCalledOnce();

    const settled = loadSubagentRegistryFromSqlite().get(input.subagent.runId)!;
    expect(settled.delivery).toMatchObject({
      status: "discarded",
      disposition: "permanent_failure",
      discardReason: "task-missing",
      // A genuinely ownerless run keeps the plain reason; no runtime holds the id.
      lastError: "task-missing",
      discardedAt: expect.any(Number),
    });
    expect(settled.completion).toEqual(completion);
    expect(settled.requesterSettleWake).toBeUndefined();
    // The production warning must read differently from the runtime-mismatch case
    // above, or an operator cannot tell true absence from a repaired collision.
    expect(warnings).toHaveBeenCalledOnce();
    expect(JSON.stringify(warnings.mock.calls[0])).toContain(input.subagent.runId);
    expect(JSON.stringify(warnings.mock.calls[0])).toContain("task-missing");
    expect(JSON.stringify(warnings.mock.calls[0])).not.toContain("task-owner-runtime-mismatch");
  });
});
