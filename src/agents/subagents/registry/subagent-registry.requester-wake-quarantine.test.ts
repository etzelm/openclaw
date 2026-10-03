// Requester settle wake quarantine (openclaw#154252). Real SQLite store, real
// SubagentLifecycleController and real maybeWakeRequesterAfterAllChildrenSettled,
// entered through the sweeper's resumeRequesterSettleWake. Only the gateway
// transport, session store and logger sink are substituted.

const probe = vi.hoisted(() => ({
  settleCalls: 0,
  settleOk: 0,
  settleErrors: [] as string[],
  settleAt: [] as number[],
  quarantineErrors: [] as string[],
  quarantineCalls: 0,
  warns: [] as Array<{ msg: string; meta?: Record<string, unknown> }>,
}));

// Explicit logger: the warn sink records every record and nothing reaches a real transport.
vi.mock("../../../logging/subsystem.js", () => {
  const logger = {
    subsystem: "test",
    isEnabled: () => false,
    trace: () => {},
    debug: () => {},
    info: () => {},
    warn: (msg: string, meta?: Record<string, unknown>) => {
      probe.warns.push({ msg, meta });
    },
    error: () => {},
    fatal: () => {},
    raw: () => {},
    child: () => logger,
  };
  return {
    createSubsystemLogger: () => logger,
    runtimeForLogger: () => ({ log: () => {}, error: () => {}, exit: () => {} }),
  };
});

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createDeferred } from "../../../../test/helpers/promise.js";
import { getRuntimeConfig } from "../../../config/config.js";
import { replaceSessionEntry } from "../../../config/sessions/session-accessor.js";
import { callGateway } from "../../../gateway/call.js";
import type { GatewayRequestContext } from "../../../gateway/server-methods/types.js";
import { onAgentEvent } from "../../../infra/agent-events.js";
import { openOpenClawStateDatabase } from "../../../state/openclaw-state-db.js";
import "../spawn/subagent-spawn-model.mocks.shared.js";
import {
  createOpenClawTestState,
  type OpenClawTestState,
} from "../../../test-utils/openclaw-test-state.js";
import { loadAgentRuntimePluginRegistryHandle } from "../../runtime-plugins.js";
import { testing as subagentAnnounceDeliveryTesting } from "../announce/subagent-announce-delivery.test-support.js";
import { testing as subagentAnnounceOutputTesting } from "../announce/subagent-announce-output.test-support.js";
import { announceTesting as subagentAnnounceTesting } from "../announce/subagent-announce-overrides.test-support.js";
import { maybeWakeRequesterAfterAllChildrenSettled } from "../announce/subagent-announce.requester-settle-wake.js";
import * as completionStore from "../completion/subagent-completion-admission.store.js";
import { SubagentRegistryWriteError } from "./subagent-registry-persistence.js";
import { saveSubagentRegistryChangesToSqlite } from "./subagent-registry-state.fixture.test-support.js";
import { observeRootWork } from "./subagent-registry.browser-cleanup.test-support.js";
import type {
  GatewayRequest,
  SessionStoreEntry,
} from "./subagent-registry.lifecycle-fixture.test-support.js";
import { createLifecycleWaits } from "./subagent-registry.lifecycle-waits.test-support.js";
import { loadSubagentRegistryFromSqlite } from "./subagent-registry.store.sqlite.js";
import * as registry from "./subagent-registry.test-helpers.js";

const MAIN_REQUESTER_SESSION_KEY = "agent:main:main";
const RUN_ID = "run-154252";
const DAY = 24 * 60 * 60 * 1000;
const T0 = Date.UTC(2026, 9, 3, 12, 0, 0);
// Longer than the 120s retry ceiling, so every tick admits at most one retry.
const TICK_MS = 600_000;
const QUARANTINE_AFTER = 5;
const OWNER_CHANGED = /subagent completion owner changed before settlement: /;

let sessionStore: Record<string, SessionStoreEntry> = {};
let sessionStorePath: string;
let agentCallObserved = createDeferred();
let storageOutage = false;
// Runs inside a rejected settle, before the error reaches the episode: the test's seam for a foreign write.
let afterSettleFailure: ((failures: number) => void) | undefined;

const callGatewayMock = vi.fn(async (request: GatewayRequest) => {
  if (request.method === "agent.wait") {
    return { status: "pending" };
  }
  if (request.method === "chat.history") {
    return { messages: [] };
  }
  if (request.method === "agent") {
    agentCallObserved.resolve();
    agentCallObserved = createDeferred();
    return {
      result: {
        payloads: [{ text: "completion delivered" }],
        deliveryStatus: { status: "sent", resultCount: 1 },
      },
    };
  }
  return {};
});

const loadConfigMock = vi.mocked(getRuntimeConfig);

vi.mock("../../../config/config.js", { spy: true });
vi.mock("../../../gateway/call.js", { spy: true });
vi.mock("../../../infra/agent-events.js", { spy: true });
vi.mock("../../runtime-plugins.js", async () => {
  const { createEmptyPluginRegistry } = await import("../../../plugins/registry-empty.js");
  return {
    loadAgentRuntimePluginRegistryHandle: vi.fn<
      typeof import("../../runtime-plugins.js").loadAgentRuntimePluginRegistryHandle
    >(() => createEmptyPluginRegistry()),
  };
});
vi.mock("../announce/subagent-announce.requester-settle-wake.js", { spy: true });

const { maybeWakeRequesterAfterAllChildrenSettled: wakeRequester } = await vi.importActual<
  typeof import("../announce/subagent-announce.requester-settle-wake.js")
>("../announce/subagent-announce.requester-settle-wake.js");

function createGatewayContext() {
  const recoveryRuntime: GatewayRequestContext["recoveryRuntime"] = {
    dispatchAgent: (params, timeoutMs) => callGateway({ method: "agent", params, timeoutMs }),
    waitForAgent: (params, timeoutMs, signal) =>
      callGateway({ method: "agent.wait", params, timeoutMs, signal }),
    dispatchSessionMethod: (method, params, options) =>
      callGateway({
        method,
        params,
        timeoutMs: options?.timeoutMs,
        signal: options?.signal,
        assertDispatchCurrent: options?.assertCurrent,
      }),
    sendRecoveryNotice: async () => {
      throw new Error("Unexpected recovery notice");
    },
  };
  // Activation binds this context to every row restored at boot, and wake release reads
  // the child's abort controllers through it.
  const context = {
    recoveryRuntime,
    chatAbortControllers: new Map(),
  } as unknown as GatewayRequestContext;
  context.resolveGatewayContext = () => context;
  return context;
}

vi.mock("../../../config/sessions.js", async () => ({
  ...(await import("../../../config/sessions/targets.js")),
  ...(await import("../../../config/sessions/main-session.js")),
  loadSessionStore: vi.fn(() => sessionStore),
  resolveAgentIdFromSessionKey: (key: string) => key.match(/^agent:([^:]+)/)?.[1] ?? "main",
  resolveSessionStorePathCore: () => sessionStorePath,
  resolveMainSessionKey: () => MAIN_REQUESTER_SESSION_KEY,
  updateSessionStore: vi.fn(),
}));

vi.mock("../../../plugins/hook-runner-global.js", () => ({
  getGlobalHookRunner: vi.fn(() => null),
}));

vi.mock("../../../browser-lifecycle-cleanup.js", () => ({
  cleanupBrowserSessionsForLifecycleEnd: vi.fn(async () => {}),
}));

vi.mock("../spawn/subagent-depth.js", () => ({
  getSubagentDepthFromSessionStore: () => 0,
}));

type RowSeed = Record<string, unknown>;

const baseRow = (endedAt: number, overrides: RowSeed = {}): RowSeed => ({
  runId: RUN_ID,
  childSessionKey: "agent:main:subagent:child-154252",
  requesterSessionKey: MAIN_REQUESTER_SESSION_KEY,
  requesterDisplayKey: "main",
  requesterAgentId: "main",
  task: "killed child",
  cleanup: "keep",
  createdAt: endedAt - 5_000,
  execution: {
    status: "terminal",
    startedAt: endedAt - 4_000,
    endedAt,
    outcome: { status: "error", error: "killed by operator" },
  },
  endedReason: "subagent-killed",
  expectsCompletionMessage: true,
  completion: { required: true, resultText: "partial result" },
  delivery: { status: "pending" },
  cleanupCompletedAt: endedAt + 1,
  requesterSettleWake: {
    status: "pending",
    attemptCount: 3,
    rearmGeneration: 1,
    batchRunIds: [RUN_ID],
  },
  ...overrides,
});

describe("requester settle wake quarantine (#154252)", () => {
  let previousFastTestEnv: string | undefined;
  let testState: OpenClawTestState;
  let settleRootWork: ReturnType<typeof observeRootWork>;
  const { flushAsync } = createLifecycleWaits(MAIN_REQUESTER_SESSION_KEY);

  // One state directory for the file: booting the real SQLite worker costs most of a
  // test's wall time, so each test clears the rows it wrote instead.
  beforeAll(async () => {
    testState = await createOpenClawTestState({ scenario: "minimal", applyEnv: true });
    sessionStorePath = testState.statePath("agents", "main", "sessions", "sessions.json");
  });

  afterAll(async () => {
    await testState.cleanup();
  });

  beforeEach(async () => {
    openOpenClawStateDatabase().db.exec("DELETE FROM subagent_runs");
    previousFastTestEnv = process.env.OPENCLAW_TEST_FAST;
    process.env.OPENCLAW_TEST_FAST = "1";
    loadConfigMock.mockReset().mockReturnValue({
      agents: {
        defaults: { subagents: { archiveAfterMinutes: 0 } },
        list: [{ id: "main" }, { id: "research" }],
      },
      session: { mainKey: "main", scope: "per-sender" },
    });
    callGatewayMock.mockClear();
    vi.mocked(callGateway).mockImplementation(callGatewayMock as typeof callGateway);
    vi.mocked(loadAgentRuntimePluginRegistryHandle).mockReset();
    vi.mocked(onAgentEvent).mockImplementation(() => () => {});
    agentCallObserved = createDeferred();
    sessionStore = {
      [MAIN_REQUESTER_SESSION_KEY]: {
        sessionId: "sess-main",
        updatedAt: 1,
        delivery: {
          kind: "external",
          route: { channel: "discord", accountId: "default", target: { to: "user-1" } },
          context: { channel: "discord", to: "user-1", accountId: "default" },
          origin: { provider: "discord", to: "user-1", accountId: "default" },
        },
      },
    };
    await replaceSessionEntry(
      { storePath: sessionStorePath, sessionKey: MAIN_REQUESTER_SESSION_KEY },
      sessionStore[MAIN_REQUESTER_SESSION_KEY]!,
    );
    vi.useFakeTimers();
    settleRootWork = observeRootWork();
    probe.settleCalls = 0;
    probe.settleOk = 0;
    probe.settleErrors.length = 0;
    probe.settleAt.length = 0;
    probe.quarantineErrors.length = 0;
    probe.quarantineCalls = 0;
    probe.warns.length = 0;
    storageOutage = false;
    afterSettleFailure = undefined;
    const settle = completionStore.settleRequesterCompletionBatch;
    vi.spyOn(completionStore, "settleRequesterCompletionBatch").mockImplementation(
      async (params) => {
        probe.settleCalls += 1;
        probe.settleAt.push(Date.now());
        try {
          if (storageOutage) {
            // The failure a read-only or locked state database produces, in the same wrapper
            // the real write path throws. A read-only state directory hangs the SQLite worker
            // broker under fake timers, and a trigger fails the schema admission check.
            throw new SubagentRegistryWriteError(
              "not-committed",
              Object.assign(new Error("attempt to write a readonly database"), {
                code: "ERR_SQLITE_ERROR",
              }),
            );
          }
          const result = await settle(params);
          probe.settleOk += 1;
          return result;
        } catch (error) {
          probe.settleErrors.push(error instanceof Error ? error.message : String(error));
          afterSettleFailure?.(probe.settleErrors.length);
          throw error;
        }
      },
    );
    const quarantine = completionStore.quarantineRequesterSettleWake;
    vi.spyOn(completionStore, "quarantineRequesterSettleWake").mockImplementation(
      async (params) => {
        probe.quarantineCalls += 1;
        try {
          return await quarantine(params);
        } catch (error) {
          probe.quarantineErrors.push(error instanceof Error ? error.message : String(error));
          throw error;
        }
      },
    );
    vi.mocked(maybeWakeRequesterAfterAllChildrenSettled).mockImplementation(
      async (params) => await wakeRequester(params),
    );
    subagentAnnounceTesting.setDepsForTest({
      callGateway: callGatewayMock as typeof import("../../../gateway/call.js").callGateway,
      getRuntimeConfig: loadConfigMock,
    });
    subagentAnnounceDeliveryTesting.setDepsForTest({
      sendMessage: vi.fn(async () => ({
        channel: "discord",
        to: "user-1",
        via: "direct",
        mediaUrl: null,
        result: { messageId: "unexpected-fallback" },
      })) as never,
      callGateway: callGatewayMock as typeof import("../../../gateway/call.js").callGateway,
      getRuntimeConfig: loadConfigMock,
      loadSessionEntry: ({ sessionKey }) => sessionStore[sessionKey],
      getRequesterSessionActivity: (requesterSessionKey: string) => ({
        sessionId: sessionStore[requesterSessionKey]?.sessionId,
        isActive: false,
      }),
    });
    subagentAnnounceOutputTesting.setDepsForTest({
      callGateway: callGatewayMock as typeof import("../../../gateway/call.js").callGateway,
      getRuntimeConfig: loadConfigMock,
      readSubagentSessionEntry: (_storePath, sessionKey) => sessionStore[sessionKey],
      resolveAgentIdFromSessionKey: (key) => key?.match(/^agent:([^:]+)/)?.[1] ?? "main",
      resolveSessionStorePathCore: () => sessionStorePath,
    });
  });

  afterEach(async () => {
    try {
      try {
        await vi.advanceTimersByTimeAsync(0);
      } finally {
        await settleRootWork();
      }
    } finally {
      subagentAnnounceDeliveryTesting.setDepsForTest();
      subagentAnnounceOutputTesting.setDepsForTest();
      subagentAnnounceTesting.setDepsForTest();
      await registry.resetSubagentRegistryForTests({ persist: false });
      vi.useRealTimers();
      vi.restoreAllMocks();
      if (previousFastTestEnv === undefined) {
        delete process.env.OPENCLAW_TEST_FAST;
      } else {
        process.env.OPENCLAW_TEST_FAST = previousFastTestEnv;
      }
    }
  });

  const quarantineWarns = () =>
    probe.warns.filter((warn) => warn.msg === "requester settle wake quarantined");

  /** The row exactly as SQLite stores it, not the resident copy. */
  const readRow = (runId = RUN_ID) => loadSubagentRegistryFromSqlite().get(runId);

  const tick = async () => {
    const before = probe.settleCalls;
    await vi.advanceTimersByTimeAsync(TICK_MS);
    await registry.testing.sweepOnceForTests();
    await flushAsync();
    return probe.settleCalls - before;
  };

  const start = async () => {
    vi.setSystemTime(T0);
    await registry.initSubagentRegistry();
    await registry.activateSubagentRegistry(() => createGatewayContext());
  };

  const seed = async (row: RowSeed) => {
    await registry.addSubagentRunForTests(row as never);
  };

  const run = async (ticks: number) => {
    const perTick: number[] = [];
    for (let i = 0; i < ticks; i += 1) {
      perTick.push(await tick());
    }
    return perTick;
  };

  const WINDOW_TICKS = 12;
  // Both legs observe the same first window. The fixed row then keeps going until its
  // quarantine lands (the cadence depends on timer alignment), and a quiet tail proves it.
  const driveToQuarantine = async () => {
    const perTick = await run(WINDOW_TICKS);
    const callsInWindow = probe.settleCalls;
    while (quarantineWarns().length === 0 && perTick.length < 60) {
      perTick.push(await tick());
    }
    const quiet = await run(6);
    return { perTick: [...perTick, ...quiet], callsInWindow, quiet };
  };

  /** One greppable evidence line per shape; identical in the before and after legs. */
  const report = (label: string, perTick: readonly number[], callsInWindow?: number) => {
    const errors = new Map<string, number>();
    for (const message of probe.settleErrors) {
      errors.set(message, (errors.get(message) ?? 0) + 1);
    }
    const row = readRow();
    console.log(
      [
        `[154252] ${label}`,
        `ticks=${perTick.length} settleCalls@${WINDOW_TICKS}=${callsInWindow ?? "n/a"} settleCalls=${probe.settleCalls} settleOk=${probe.settleOk} settleErrors=${probe.settleErrors.length}`,
        `perTick=${perTick.join(",")}`,
        `errors=${JSON.stringify([...errors])}`,
        `warns=${JSON.stringify(probe.warns.map((warn) => warn.msg))}`,
        `quarantineWarn=${JSON.stringify(quarantineWarns().map((warn) => warn.meta))}`,
        `sqliteRow wake=${JSON.stringify(row?.requesterSettleWake)} delivery=${JSON.stringify(row?.delivery)} present=${Boolean(row)}`,
      ].join("\n  "),
    );
  };

  const expectBounded = (quiet: readonly number[]) => {
    expect(probe.settleErrors).toHaveLength(QUARANTINE_AFTER);
    for (const message of probe.settleErrors) {
      expect(message).toMatch(OWNER_CHANGED);
    }
    // No settle attempt in the 6 ticks (an hour) after the quarantine.
    expect(quiet.every((calls) => calls === 0)).toBe(true);
    expect(quarantineWarns()).toHaveLength(1);
    expect(quarantineWarns()[0]?.meta).toMatchObject({
      signature: "subagent completion owner changed before settlement",
      failures: QUARANTINE_AFTER,
    });
  };

  it("B1: a terminal row without an outcome is quarantined and suspended, not retried forever", async () => {
    const endedAt = T0 - 3_600_000;
    await start();
    await seed(
      baseRow(endedAt, { execution: { status: "terminal", startedAt: endedAt - 4_000, endedAt } }),
    );
    const { perTick, callsInWindow, quiet } = await driveToQuarantine();
    report("B1 terminal row, execution.outcome undefined", perTick, callsInWindow);
    expectBounded(quiet);
    const row = readRow();
    expect(row?.requesterSettleWake).toBeUndefined();
    expect(row?.delivery).toMatchObject({
      status: "suspended",
      disposition: "permanent_failure",
      suspendedReason: "permanent_failure",
      suspendedAt: expect.any(Number),
      lastDropReason: "sink_unavailable",
      lastError: expect.stringContaining("quarantined after 5 identical settlement failures"),
    });
  });

  it("re-woken: a re-armed quarantined row wakes the requester once, settles once, and goes quiet", async () => {
    const endedAt = T0 - 3_600_000;
    await start();
    await seed(
      baseRow(endedAt, { execution: { status: "terminal", startedAt: endedAt - 4_000, endedAt } }),
    );
    const { quiet } = await driveToQuarantine();
    expectBounded(quiet);
    const quarantined = readRow();
    expect(quarantined?.delivery?.status).toBe("suspended");
    const agentCalls = () =>
      callGatewayMock.mock.calls.filter(([request]) => request.method === "agent").length;
    const announcesBefore = agentCalls();
    const settleCallsBefore = probe.settleCalls;

    // A later child settling re-arms the requester wake on the same row.
    await seed({
      ...quarantined,
      requesterSettleWake: {
        status: "pending",
        attemptCount: 0,
        rearmGeneration: 2,
        batchRunIds: [RUN_ID],
      },
    });
    // The re-armed wake settles once against the suspended row and clears itself.
    const perTick: number[] = [];
    while (probe.settleOk === 0 && perTick.length < 60) {
      perTick.push(await tick());
    }
    const quietAgain = await run(6);
    report("re-woken quarantined row", [...perTick, ...quietAgain]);

    expect(probe.settleCalls - settleCallsBefore).toBe(1);
    expect(probe.settleErrors).toHaveLength(QUARANTINE_AFTER);
    expect(quarantineWarns()).toHaveLength(1);
    // The wake is an ordinary one: the requester is told the result once, and the suspended
    // record is neither re-delivered nor looped on.
    expect(agentCalls()).toBe(announcesBefore + 1);
    expect(
      callGatewayMock.mock.calls.findLast(([request]) => request.method === "agent")?.[0].params,
    ).toMatchObject({ message: expect.stringContaining("partial result") });
    expect(quietAgain.every((calls) => calls === 0)).toBe(true);
    expect(readRow()?.requesterSettleWake).toBeUndefined();
    expect(readRow()?.delivery).toEqual(quarantined?.delivery);
  });

  it("first boot after an upgrade quarantines a row stranded before it, through restore and the sweeper", async () => {
    const endedAt = T0 - 3_600_000;
    // Written by the previous version: a persisted wake at the attempt ceiling on a row whose
    // settle can only fail with the owner-changed rejection. The row goes through the
    // registry's own writer, then the registry is torn down so that nothing in memory knows
    // the row or counts its failures.
    await start();
    await seed(
      baseRow(endedAt, {
        execution: { status: "terminal", startedAt: endedAt - 4_000, endedAt },
        requesterSettleWake: {
          status: "pending",
          attemptCount: QUARANTINE_AFTER,
          rearmGeneration: 1,
          batchRunIds: [RUN_ID],
        },
      }),
    );
    // The gateway restarts: every in-memory registry, controller and timer is torn down
    // without touching SQLite, and the only state left is the stored row.
    await registry.resetSubagentRegistryForTests({ persist: false });
    probe.settleCalls = 0;
    probe.settleOk = 0;
    probe.settleErrors.length = 0;
    probe.settleAt.length = 0;
    probe.warns.length = 0;
    expect(registry.getSubagentRunByRunId(RUN_ID)).toBeUndefined();
    expect(readRow()?.requesterSettleWake).toMatchObject({ status: "pending" });
    expect(probe.settleCalls).toBe(0);

    // The gateway's own startup: initSubagentRegistry (server-startup-bootstrap) restores
    // from SQLite, activation re-arms what restore found, and the sweeper owns the rest.
    await start();
    expect(registry.getSubagentRunByRunId(RUN_ID)?.requesterSettleWake).toMatchObject({
      status: "pending",
    });
    const { perTick, callsInWindow, quiet } = await driveToQuarantine();
    report("first boot after upgrade, stranded row restored from SQLite", perTick, callsInWindow);

    // Exactly the budget, then the quarantine; nothing retries over the quiet hour after it.
    expect(probe.settleCalls).toBe(QUARANTINE_AFTER);
    expectBounded(quiet);
    await run(WINDOW_TICKS);
    expect(probe.settleCalls).toBe(QUARANTINE_AFTER);
    expect(quarantineWarns()).toHaveLength(1);
    const row = readRow();
    expect(row?.requesterSettleWake).toBeUndefined();
    expect(row?.delivery).toMatchObject({
      status: "suspended",
      disposition: "permanent_failure",
      suspendedReason: "permanent_failure",
      lastError: expect.stringContaining("quarantined after 5 identical settlement failures"),
    });
  });

  it("B2: a retired cancellation with a newer sibling on its child session is suspended", async () => {
    await start();
    await seed(baseRow(T0 - 8 * DAY, { generation: 1 }));
    await seed({
      runId: `${RUN_ID}-newer`,
      childSessionKey: "agent:main:subagent:child-154252",
      requesterSessionKey: MAIN_REQUESTER_SESSION_KEY,
      requesterDisplayKey: "main",
      requesterAgentId: "main",
      task: "newer generation",
      cleanup: "keep",
      createdAt: T0 - DAY,
      generation: 2,
      execution: {
        status: "terminal",
        startedAt: T0 - DAY,
        endedAt: T0 - DAY + 1_000,
        outcome: { status: "ok" },
      },
      delivery: { status: "delivered", disposition: "delivered" },
      cleanupCompletedAt: T0 - DAY + 2_000,
    });
    const { perTick, callsInWindow, quiet } = await driveToQuarantine();
    report(
      "B2 8d-old retired cancellation, generation 2 sibling on the same child session",
      perTick,
      callsInWindow,
    );
    expectBounded(quiet);
    const row = readRow();
    expect(row?.requesterSettleWake).toBeUndefined();
    expect(row?.delivery).toMatchObject({
      status: "suspended",
      suspendedReason: "permanent_failure",
      disposition: "permanent_failure",
    });
    // The sibling's own delivery is untouched.
    expect(readRow(`${RUN_ID}-newer`)?.delivery?.status).toBe("delivered");
  });

  it("Ch: a frozen cohort member present only in SQLite is bounded and the deliverable row is handed back", async () => {
    const endedAt = T0 - 3_600_000;
    const cohort = [RUN_ID, `${RUN_ID}-b`];
    await start();
    await seed(
      baseRow(endedAt, {
        // A deliverable row: an ordinary error outcome with no kill marker.
        endedReason: "subagent-error",
        requesterSettleWake: {
          status: "pending",
          attemptCount: 3,
          rearmGeneration: 1,
          batchRunIds: cohort,
        },
      }),
    );
    saveSubagentRegistryChangesToSqlite(
      new Map([
        [
          `${RUN_ID}-b`,
          baseRow(endedAt, {
            runId: `${RUN_ID}-b`,
            childSessionKey: "agent:main:subagent:child-154252-b",
            requesterAgentId: "research",
            requesterSettleWake: {
              status: "pending",
              attemptCount: 3,
              rearmGeneration: 1,
              batchRunIds: cohort,
            },
          }) as never,
        ],
      ]),
      [`${RUN_ID}-b`],
    );
    const { perTick, callsInWindow, quiet } = await driveToQuarantine();
    report("Ch frozen cohort [A,B], B only in SQLite", perTick, callsInWindow);
    expectBounded(quiet);
    const row = readRow();
    expect(row?.requesterSettleWake).toBeUndefined();
    // A deliverable result is retained as a failed delivery with its payload, never suspended.
    expect(row?.delivery).toMatchObject({
      status: "failed",
      payload: expect.objectContaining({ childRunId: RUN_ID }),
      lastError: expect.stringContaining("quarantined after 5 identical settlement failures"),
    });
    expect(row?.delivery?.suspendedReason).toBeUndefined();
    expect(row?.completion?.resultText).toBe("partial result");
    // Failed rows keep their payload under the ordinary archive rules: a keep-cleanup row has
    // no archive deadline, so a sweep a week past the 7 day suspended retention leaves it whole.
    vi.setSystemTime(Date.now() + 8 * DAY);
    await registry.testing.sweepOnceForTests();
    await flushAsync();
    expect(readRow()?.delivery).toEqual(row?.delivery);
  });

  it("a delivery re-arm during the final attempt refuses the quarantine and the episode keeps retrying at the capped 120s cadence", async () => {
    const endedAt = T0 - 3_600_000;
    await start();
    await seed(
      baseRow(endedAt, { execution: { status: "terminal", startedAt: endedAt - 4_000, endedAt } }),
    );
    let rearmed: ReturnType<typeof readRow>;
    // The fifth rejection is the one that reaches the quarantine. A new delivery generation
    // with its own payload commits to SQLite between that rejection and the quarantine write.
    afterSettleFailure = (failures) => {
      const row = readRow();
      if (failures !== QUARANTINE_AFTER || !row?.delivery) {
        return;
      }
      saveSubagentRegistryChangesToSqlite(
        new Map([
          [
            RUN_ID,
            {
              ...row,
              delivery: {
                ...row.delivery,
                status: "pending",
                generation: 2,
                payload: {
                  requesterSessionKey: MAIN_REQUESTER_SESSION_KEY,
                  childSessionKey: row.childSessionKey,
                  childRunId: RUN_ID,
                  task: "re-armed delivery",
                  startedAt: endedAt - 4_000,
                  endedAt,
                  expectsCompletionMessage: true,
                },
              },
            } as never,
          ],
        ]),
        [RUN_ID],
      );
      rearmed = readRow();
    };
    const queuedForRequester = () =>
      (
        openOpenClawStateDatabase()
          .db.prepare("SELECT COUNT(*) AS n FROM delivery_queue_entries WHERE session_key = ?")
          .get(MAIN_REQUESTER_SESSION_KEY) as { n: number }
      ).n;
    const stepUntil = async (done: () => boolean, maxSteps: number) => {
      for (let i = 0; i < maxSteps && !done(); i += 1) {
        await vi.advanceTimersByTimeAsync(5_000);
        await flushAsync();
      }
    };

    // Whole ticks until four rejections have landed; the fifth arrives on the episode's own
    // retry timer, which the 5s steps resolve.
    const perTick: number[] = [];
    while (probe.settleErrors.length < QUARANTINE_AFTER - 1 && perTick.length < 60) {
      perTick.push(await tick());
    }
    await stepUntil(() => rearmed !== undefined, 400);
    expect(rearmed?.delivery?.generation).toBe(2);
    const settlesAtRefusal = probe.settleCalls;
    // Keep stepping until the episode has retried several more times.
    await stepUntil(() => probe.settleCalls >= settlesAtRefusal + 5, 1_440);
    report("delivery re-armed before the quarantine write", perTick);

    // The in-flight write sees the re-arm before the worker does: the queued write's version
    // check and the plan's generation guard refuse it, so the kernel compare is not reached
    // here. The refusal is an ordinary commit failure.
    expect(probe.quarantineCalls).toBe(1);
    expect(probe.quarantineErrors).toEqual([
      "Subagent requester wake cohort changed before mutation",
    ]);
    expect(quarantineWarns()).toEqual([]);
    expect(queuedForRequester()).toBe(0);
    // The row, with the new delivery's payload, is exactly what the foreign write left.
    expect(readRow()).toEqual(rearmed);

    // The episode is not released and not quarantined by the refusal: it retries forever
    // at the 120s ceiling, every attempt failing the same plan guard, and the count of
    // identical owner-changed rejections is never advanced again (no second quarantine).
    const retries = probe.settleErrors.slice(QUARANTINE_AFTER);
    expect(retries.length).toBeGreaterThanOrEqual(5);
    for (const message of retries) {
      expect(message).toBe("Subagent requester wake cohort changed before mutation");
    }
    expect(probe.quarantineCalls).toBe(1);
    expect(probe.settleOk).toBe(0);
    const gaps = probe.settleAt
      .slice(QUARANTINE_AFTER + 1)
      .map((at, index, all) => (index === 0 ? 0 : at - all[index - 1]!))
      .slice(1);
    // The first retry after the refusal rides the same fake clock as the refresh I/O; the
    // steady state after it is the ceiling.
    expect(gaps.length).toBeGreaterThanOrEqual(3);
    expect(gaps.every((gap) => gap === 120_000)).toBe(true);
    expect(readRow()?.requesterSettleWake).toMatchObject({ status: "pending" });
  });

  it("negative control: A1 and A2 kill-reconciliation rows still settle with zero quarantines", async () => {
    await start();
    await seed(baseRow(T0 - 3_600_000, { killReconciliation: { killedAt: T0 - 3_600_000 } }));
    const perTick = await run(10);
    report("A1 killed 1h ago, killReconciliation{killedAt=endedAt}", perTick);
    expect(probe.settleErrors).toEqual([]);
    expect(probe.settleOk).toBeGreaterThanOrEqual(1);
    expect(quarantineWarns()).toEqual([]);
    expect(readRow()?.requesterSettleWake).toBeUndefined();
  });

  it("negative control: an 8 day old kill marker still settles with zero quarantines", async () => {
    await start();
    await seed(baseRow(T0 - 8 * DAY, { killReconciliation: { killedAt: T0 - 8 * DAY } }));
    const perTick = await run(10);
    report("A2 killed 8d ago, killReconciliation{killedAt=endedAt}", perTick);
    expect(probe.settleErrors).toEqual([]);
    expect(probe.settleOk).toBeGreaterThanOrEqual(1);
    expect(quarantineWarns()).toEqual([]);
    expect(readRow()?.requesterSettleWake).toBeUndefined();
  });

  it("negative control: a storage outage retries past the quarantine budget and settles after recovery", async () => {
    await start();
    await seed(baseRow(T0 - 3_600_000, { killReconciliation: { killedAt: T0 - 3_600_000 } }));
    storageOutage = true;
    const outage: number[] = [];
    try {
      // Drive until the outage has rejected more settles than the quarantine budget.
      while (probe.settleErrors.length < QUARANTINE_AFTER + 2 && outage.length < 80) {
        outage.push(await tick());
      }
    } finally {
      storageOutage = false;
    }
    const failedDuringOutage = probe.settleErrors.length;
    const rowDuringOutage = readRow();
    // Synchronize on the state recovery produces, not on a tick count: the retained episode
    // clears and a follow-up wake may still be dispatching when the first settle lands.
    const recovered: number[] = [];
    while ((probe.settleOk === 0 || readRow()?.requesterSettleWake) && recovered.length < 80) {
      recovered.push(await tick());
    }
    report("storage outage then recovery", [...outage, ...recovered]);
    expect(failedDuringOutage).toBeGreaterThan(QUARANTINE_AFTER);
    for (const message of probe.settleErrors) {
      expect(message).toContain("attempt to write a readonly database");
      expect(message).not.toMatch(OWNER_CHANGED);
    }
    expect(rowDuringOutage?.requesterSettleWake).toBeDefined();
    expect(quarantineWarns()).toEqual([]);
    expect(probe.settleOk).toBeGreaterThanOrEqual(1);
    expect(readRow()?.requesterSettleWake).toBeUndefined();
  });
});
