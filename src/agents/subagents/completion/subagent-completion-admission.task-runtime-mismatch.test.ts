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
import { resetTaskRegistryForTests } from "../../../tasks/task-runtime.test-helpers.js";
import { SUBAGENT_ENDED_REASON_COMPLETE } from "../registry/subagent-lifecycle-events.js";
import { subagentRuns } from "../registry/subagent-registry-memory.js";
import { loadSubagentRegistryFromSqlite } from "../registry/subagent-registry.store.sqlite.js";
import { settleSubagentCompletionDelivery } from "./subagent-completion-admission.store.js";
import {
  armRequesterWake,
  records,
  requesterWakeDriver,
} from "./subagent-completion-admission.test-helpers.js";

const tempDirs = useAutoCleanupTempDirTracker(afterAll);
vi.mock("../registry/subagent-registry.js", () => ({ resumeSubagentRun: vi.fn() }));

/**
 * Run ids are not unique across task runtimes, so a requester-settle wake can
 * resolve a row this completion does not own. That owner can never become a
 * subagent row, so settlement must terminalize once instead of re-arming.
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

  const readOwnerRow = () =>
    database.db
      .prepare("SELECT runtime, status, delivery_status FROM task_runs WHERE task_id = ?")
      .get("task-completion");

  it.each(["cli", "cron", "acp"] as const)(
    "settles an undelivered requester wake once when its task owner is runtime=%s",
    async (runtime) => {
      const input = records();
      input.subagent.endedReason = SUBAGENT_ENDED_REASON_COMPLETE;
      input.subagent.delivery = { status: "pending", deadlineAt: Date.now() + 600_000 };
      armRequesterWake(input);
      settleSubagentCompletionDelivery({ ...input, databaseOptions: { database } });
      // Reproduces the reported shape: a succeeded child whose persisted ledger row
      // belongs to another runtime, so the subagent owner lookup never matches.
      database.db
        .prepare("UPDATE task_runs SET runtime = ? WHERE task_id = ?")
        .run(runtime, input.task.taskId);
      const ownerRowBefore = readOwnerRow();
      reopenOwners();
      input.subagent = subagentRuns.get(input.subagent.runId)!;
      const completion = structuredClone(input.subagent.completion);

      const driver = requesterWakeDriver([input]);
      driver.controller.options.callGateway = vi.fn().mockResolvedValue({ messages: [] });
      driver.wake.mockImplementation(async (params) => {
        params.completeBatch([input.subagent], 1, {
          delivered: false,
          path: "none",
          error: "requester unavailable",
        });
        return false;
      });
      try {
        driver.controller.resumeRequesterSettleWake(
          input.subagent.runId,
          input.subagent,
          "restore",
        );
        await vi.advanceTimersByTimeAsync(300_000);
        expect(getActiveGatewayRootWorkCount()).toBe(0);
        expect(driver.wake).toHaveBeenCalledOnce();

        const settled = loadSubagentRegistryFromSqlite().get(input.subagent.runId)!;
        expect(settled.delivery).toMatchObject({
          status: "discarded",
          disposition: "permanent_failure",
          discardReason: "task-missing",
          lastError: "task-owner-runtime-mismatch",
          discardedAt: expect.any(Number),
        });
        // The child result survives; only its delivery is terminalized.
        expect(settled.completion).toEqual(completion);
        expect(settled.requesterSettleWake).toBeUndefined();
        // Settlement never reaches into a row owned by another runtime.
        expect(readOwnerRow()).toEqual(ownerRowBefore);

        driver.controller.clearScheduledResumeTimers();
        reopenOwners();
        input.subagent = subagentRuns.get(input.subagent.runId)!;
        const restarted = requesterWakeDriver([input]);
        try {
          restarted.controller.resumeRequesterSettleWake(
            input.subagent.runId,
            input.subagent,
            "restore",
          );
          await vi.advanceTimersByTimeAsync(300_000);
          // A second sweep after restart neither re-enters the wake nor warns again.
          expect(restarted.wake).not.toHaveBeenCalled();
          expect(loadSubagentRegistryFromSqlite().get(input.subagent.runId)).toEqual(
            input.subagent,
          );
          // One retirement notice across both sweeps is the whole point: the first
          // settlement is terminal, so the sweeper never speaks about this run again.
          expect(warnings).toHaveBeenCalledOnce();
          expect(JSON.stringify(warnings.mock.calls[0])).toContain(input.subagent.runId);
          expect(JSON.stringify(warnings.mock.calls[0])).toContain("task-missing");
        } finally {
          restarted.controller.clearScheduledResumeTimers();
        }
      } finally {
        driver.controller.clearScheduledResumeTimers();
      }
    },
  );
});
