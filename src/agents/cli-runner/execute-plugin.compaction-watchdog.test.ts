import { afterEach, describe, expect, it, vi } from "vitest";
import { createDeferred } from "../../../test/helpers/promise.js";
import {
  closePluginTestAdmissions,
  createExecution,
  runPlugin,
  SUCCESS_RESULT,
  waitUntilAborted,
} from "./execute-plugin.test-support.js";

afterEach(() => {
  closePluginTestAdmissions();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("plugin-owned CLI execution native compaction watchdog", () => {
  it("keeps native compaction alive beyond the ordinary no-output watchdog", async () => {
    vi.useFakeTimers();
    const { context } = await createExecution();
    const compactionFinished = createDeferred();
    const received: string[] = [];
    let compacting = false;
    let completed = false;
    const run = runPlugin(
      context,
      async function* () {
        compacting = true;
        yield { type: "system", subtype: "status", status: "compacting" };
        await compactionFinished.promise;
        compacting = false;
        yield { compact_result: "success" };
        yield SUCCESS_RESULT;
      },
      {
        noOutputTimeoutMs: 100,
        consumeStdout: received.push.bind(received),
        compactionActive: () => compacting,
      },
    ).then((result) => {
      completed = true;
      return result;
    });
    await vi.waitFor(() => expect(received).toHaveLength(1));

    await vi.advanceTimersByTimeAsync(150);
    expect(completed).toBe(false);

    compactionFinished.resolve();
    await expect(run).resolves.toMatchObject({ reason: "exit", timedOut: false });
    expect(received.map((event) => JSON.parse(event))).toHaveLength(3);
  });

  it("terminates through the no-output watchdog once compaction has ended", async () => {
    vi.useFakeTimers();
    const { context } = await createExecution({ timeoutMs: 5_000 });
    const received: string[] = [];
    let compacting = false;
    const run = runPlugin(
      context,
      async function* (execution) {
        compacting = true;
        yield { type: "system", subtype: "status", status: "compacting" };
        // Compaction ends, but the turn then goes silent again with nothing
        // else outstanding; a finished compaction must not grant permanent
        // immunity from the ordinary no-output watchdog.
        compacting = false;
        yield { compact_result: "success" };
        await waitUntilAborted(execution);
        yield SUCCESS_RESULT;
      },
      {
        noOutputTimeoutMs: 100,
        consumeStdout: received.push.bind(received),
        compactionActive: () => compacting,
      },
    );
    await vi.waitFor(() => expect(received).toHaveLength(2));

    await vi.advanceTimersByTimeAsync(100);

    await expect(run).resolves.toMatchObject({
      reason: "no-output-timeout",
      exitCode: null,
      timedOut: true,
      noOutputTimedOut: true,
    });
  });

  it("keeps the overall deadline authoritative while compaction remains active", async () => {
    vi.useFakeTimers();
    const { context } = await createExecution({ timeoutMs: 150 });
    const received: string[] = [];
    const run = runPlugin(
      context,
      async function* (execution) {
        yield { type: "system", subtype: "status", status: "compacting" };
        await waitUntilAborted(execution);
        yield SUCCESS_RESULT;
      },
      {
        noOutputTimeoutMs: 100,
        consumeStdout: received.push.bind(received),
        compactionActive: () => true,
      },
    );
    await vi.waitFor(() => expect(received).toHaveLength(1));

    await vi.advanceTimersByTimeAsync(150);

    await expect(run).resolves.toMatchObject({
      reason: "overall-timeout",
      timedOut: true,
      noOutputTimedOut: false,
    });
  });
});

describe("compaction reported as outstanding work", () => {
  it("notifies onOutstandingWorkChange when compaction becomes active and inactive", async () => {
    vi.useFakeTimers();
    const { context } = await createExecution();
    const workChanged: boolean[] = [];
    let compacting = false;
    // simulate what execute-process.ts wires from events.hasActiveCompaction
    const compactionChangeListeners = new Set<() => void>();
    const onCompactionActiveChange = (listener: () => void) => {
      compactionChangeListeners.add(listener);
      return () => compactionChangeListeners.delete(listener);
    };

    const run = runPlugin(
      context,
      async function* () {
        compacting = true;
        for (const l of compactionChangeListeners) {
          l();
        }
        yield { type: "system", subtype: "status", status: "compacting" };
        compacting = false;
        for (const l of compactionChangeListeners) {
          l();
        }
        yield { compact_result: "success" };
        yield { type: "result", subtype: "success", is_error: false, result: "ok" };
      },
      {
        noOutputTimeoutMs: 10_000,
        compactionActive: () => compacting,
        onCompactionActiveChange,
        onOutstandingWorkChange: (active) => {
          workChanged.push(active);
        },
      },
    );
    await expect(run).resolves.toMatchObject({ reason: "exit", timedOut: false });
    expect(workChanged).toContain(true);
    expect(workChanged).toContain(false);
  });
});
