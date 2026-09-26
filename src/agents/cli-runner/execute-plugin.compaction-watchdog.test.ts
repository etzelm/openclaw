import { afterEach, describe, expect, it, vi } from "vitest";
import { createDeferred } from "../../../test/helpers/promise.js";
import { BLOCKED_TOOL_CALL_ABORT_FLOOR_MS } from "../../logging/diagnostic-run-activity.js";
import { CLI_COMPACTION_GRACE_MS } from "../cli-watchdog-defaults.js";
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

  it("terminates a compaction that starts and never ends at the compaction ceiling", async () => {
    vi.useFakeTimers();
    // No overall deadline in play: the no-output watchdog is the only thing that can
    // end this run, which is exactly the stalled-compaction case under review.
    const { context } = await createExecution({ timeoutMs: 60 * 60_000 });
    const received: string[] = [];
    const run = runPlugin(
      context,
      async function* (execution) {
        // A start record with no matching end record, then permanent silence.
        yield { type: "system", subtype: "status", status: "compacting" };
        await waitUntilAborted(execution);
        yield SUCCESS_RESULT;
      },
      {
        noOutputTimeoutMs: 180_000,
        consumeStdout: received.push.bind(received),
        compactionActive: () => true,
      },
    );
    await vi.waitFor(() => expect(received).toHaveLength(1));

    // One tick short of the ceiling the run is still deferred, so the bound is the
    // compaction ceiling and not some earlier coincidence.
    await vi.advanceTimersByTimeAsync(CLI_COMPACTION_GRACE_MS - 2_000);
    expect(await Promise.race([run, Promise.resolve("pending")])).toBe("pending");

    // Crossing it terminates, well inside the 15-minute blocked-tool floor that a
    // latched compaction would otherwise have held.
    await vi.advanceTimersByTimeAsync(4_000);
    await expect(run).resolves.toMatchObject({
      reason: "no-output-timeout",
      timedOut: true,
      noOutputTimedOut: true,
    });
    expect(CLI_COMPACTION_GRACE_MS).toBeLessThan(BLOCKED_TOOL_CALL_ABORT_FLOOR_MS);
  });

  it("keeps the blocked-tool floor for a compaction that overlaps real tool work", async () => {
    vi.useFakeTimers();
    const { context } = await createExecution({ timeoutMs: 60 * 60_000 });
    const received: string[] = [];
    const run = runPlugin(
      context,
      async function* (execution) {
        yield { type: "system", subtype: "status", status: "compacting" };
        await waitUntilAborted(execution);
        yield SUCCESS_RESULT;
      },
      {
        noOutputTimeoutMs: 180_000,
        consumeStdout: received.push.bind(received),
        compactionActive: () => true,
        // A tool call outstanding alongside compaction keeps the wider floor it
        // already had before compaction was ever a deferral term.
        activeToolCount: () => 1,
      },
    );
    await vi.waitFor(() => expect(received).toHaveLength(1));

    await vi.advanceTimersByTimeAsync(CLI_COMPACTION_GRACE_MS + 60_000);
    expect(await Promise.race([run, Promise.resolve("pending")])).toBe("pending");

    await vi.advanceTimersByTimeAsync(BLOCKED_TOOL_CALL_ABORT_FLOOR_MS);
    await expect(run).resolves.toMatchObject({
      reason: "no-output-timeout",
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
    // Exact sequence, not membership: `toContain` also accepts a report that
    // latches on and never withdraws. The trailing false is the terminal report
    // `executePluginOwnedProcess` makes when it closes the turn.
    expect(workChanged).toEqual([true, false, false]);
  });

  it("reports the narrower compaction ceiling only while compaction is the sole work", async () => {
    vi.useFakeTimers();
    const { context } = await createExecution();
    const reported: [boolean, number | undefined][] = [];
    let compacting = false;
    const compactionChangeListeners = new Set<() => void>();
    const onCompactionActiveChange = (listener: () => void) => {
      compactionChangeListeners.add(listener);
      return () => compactionChangeListeners.delete(listener);
    };
    const setCompacting = (next: boolean) => {
      compacting = next;
      for (const listener of compactionChangeListeners) {
        listener();
      }
    };

    const run = runPlugin(
      context,
      async function* () {
        setCompacting(true);
        yield { type: "system", subtype: "status", status: "compacting" };
        // Background work appears while compaction is still running: that work is not
        // bounded by compaction, so the report must fall back to the default floor.
        yield { type: "system", subtype: "background_tasks_changed", tasks: [{ id: "t1" }] };
        // It drains while compaction is still running: back to the narrower ceiling.
        yield { type: "system", subtype: "background_tasks_changed", tasks: [] };
        setCompacting(false);
        yield { compact_result: "success" };
        yield { type: "result", subtype: "success", is_error: false, result: "ok" };
      },
      {
        noOutputTimeoutMs: 10_000,
        compactionActive: () => compacting,
        onCompactionActiveChange,
        onOutstandingWorkChange: (active, graceFloorMs) => {
          reported.push([active, graceFloorMs]);
        },
      },
    );
    await expect(run).resolves.toMatchObject({ reason: "exit", timedOut: false });

    // Exact sequence, not membership: the narrowed floor must appear only on the
    // compaction-only reports and must never latch onto concurrent tool work.
    expect(reported).toEqual([
      [true, CLI_COMPACTION_GRACE_MS],
      [true, undefined],
      [true, CLI_COMPACTION_GRACE_MS],
      [false, undefined],
      [false, undefined],
    ]);
  });
});
