import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  PendingRequesterSettleWakeCommit,
  SubagentLifecycleWakeContext,
} from "./subagent-registry-lifecycle-context.js";
import {
  commitRequesterWake,
  getPendingWakeCommit,
  retryPendingWakeCommit,
} from "./subagent-registry-requester-wake-commit.js";
import type { SubagentRunRecord } from "./subagent-registry.types.js";

function makeRetainedChild(runId = "run-a"): SubagentRunRecord {
  return {
    runId,
    childSessionKey: `agent:main:subagent:${runId}`,
    requesterSessionKey: "agent:main:main",
    requesterDisplayKey: "main",
    task: "investigate",
    cleanup: "keep",
    createdAt: 1_000,
    execution: { status: "terminal", startedAt: 2_000, endedAt: 3_000 },
    expectsCompletionMessage: true,
    delivery: { status: "pending" },
    requesterSettleWake: { status: "dispatching", attemptCount: 3 },
  };
}

function makeContext(entries: readonly SubagentRunRecord[]): {
  context: SubagentLifecycleWakeContext;
  warn: ReturnType<typeof vi.fn>;
} {
  const warn = vi.fn();
  const runs = new Map(entries.map((entry) => [entry.runId, entry]));
  const context = {
    options: { runs, warn },
    pendingRequesterSettleWakeCommits: new WeakMap<
      SubagentRunRecord,
      PendingRequesterSettleWakeCommit
    >(),
    newerGenerationOwnsSession: () => false,
  } as unknown as SubagentLifecycleWakeContext;
  return { context, warn };
}

/**
 * Drives the real lifecycle retry seam: every sweep jumps past whatever deadline
 * the previous failure set, exactly as the settle-wake timer does in production.
 */
function sweep(
  context: SubagentLifecycleWakeContext,
  entry: SubagentRunRecord,
  sweeps: number,
): void {
  for (let pass = 0; pass < sweeps; pass += 1) {
    const pending = getPendingWakeCommit(context, entry);
    if (!pending) {
      return;
    }
    vi.setSystemTime(Math.max(Date.now(), pending.nextAttemptAt) + 1);
    retryPendingWakeCommit(context, pending);
  }
}

describe("requester settle wake commit retry", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("stops retrying a settlement write that keeps being rejected", () => {
    // Regression for a settlement commit that can never succeed. The failure
    // count only ever selected a backoff, so the sweeper retried the same
    // rejected write forever. https://github.com/openclaw/openclaw/issues/154252
    const entry = makeRetainedChild();
    const { context } = makeContext([entry]);
    const commit = vi.fn(() => false);

    commitRequesterWake(context, [entry], undefined, commit, true);
    sweep(context, entry, 50);

    expect(commit.mock.calls.length).toBeLessThan(10);
    const attemptsAfterAbandon = commit.mock.calls.length;
    sweep(context, entry, 50);
    expect(commit).toHaveBeenCalledTimes(attemptsAfterAbandon);
  });

  it("stops retrying a settlement write that keeps throwing", () => {
    const entry = makeRetainedChild();
    const { context } = makeContext([entry]);
    const commit = vi.fn(() => {
      throw new Error("database is locked");
    });

    expect(() => commitRequesterWake(context, [entry], undefined, commit, true)).toThrow(
      "database is locked",
    );
    for (let pass = 0; pass < 50; pass += 1) {
      const pending = getPendingWakeCommit(context, entry);
      if (!pending) {
        break;
      }
      vi.setSystemTime(Math.max(Date.now(), pending.nextAttemptAt) + 1);
      try {
        retryPendingWakeCommit(context, pending);
      } catch {
        // The lifecycle owner logs and reschedules; only the bound matters here.
      }
    }

    expect(commit.mock.calls.length).toBeLessThan(10);
  });

  it("leaves the wake on its row when it gives up", () => {
    // The durable write is the thing failing, so giving up must not try to
    // record an outcome. Nothing captured may be discarded.
    const entry = makeRetainedChild();
    const wakeBefore = entry.requesterSettleWake;
    const { context } = makeContext([entry]);

    commitRequesterWake(context, [entry], undefined, () => false, true);
    sweep(context, entry, 50);

    expect(entry.requesterSettleWake).toBe(wakeBefore);
    expect(entry.requesterSettleWake).toMatchObject({
      status: "dispatching",
      attemptCount: 3,
    });
    expect(entry.delivery).toMatchObject({ status: "pending" });
  });

  it("reports the abandoned settlement once, with its run ids", () => {
    const entry = makeRetainedChild();
    const { context, warn } = makeContext([entry]);

    commitRequesterWake(context, [entry], undefined, () => false, true);
    sweep(context, entry, 50);

    const abandoned = warn.mock.calls.filter(
      ([message]) => message === "requester settle wake commit abandoned after repeated failures",
    );
    expect(abandoned).toHaveLength(1);
    expect(abandoned[0]?.[1]).toMatchObject({ runIds: expect.any(Array) });
  });

  it("keeps retrying while the write can still succeed", () => {
    const entry = makeRetainedChild();
    const { context } = makeContext([entry]);
    let attempts = 0;
    const commit = vi.fn(() => {
      attempts += 1;
      return attempts >= 3;
    });

    commitRequesterWake(context, [entry], undefined, commit, true);
    sweep(context, entry, 50);

    expect(commit).toHaveBeenCalledTimes(3);
    expect(getPendingWakeCommit(context, entry)).toBeUndefined();
  });

  it("gives a genuinely new obligation its own budget", () => {
    const entry = makeRetainedChild();
    const { context } = makeContext([entry]);

    commitRequesterWake(context, [entry], undefined, () => false, true);
    sweep(context, entry, 50);

    // A re-armed wake is a different obligation, so the abandoned one releases.
    entry.requesterSettleWake = { status: "pending", attemptCount: 0 };
    expect(getPendingWakeCommit(context, entry)).toBeUndefined();

    const nextCommit = vi.fn(() => true);
    commitRequesterWake(context, [entry], undefined, nextCommit, true);
    expect(nextCommit).toHaveBeenCalledOnce();
    expect(getPendingWakeCommit(context, entry)).toBeUndefined();
  });
});
