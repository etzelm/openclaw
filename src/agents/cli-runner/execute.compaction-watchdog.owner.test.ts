/**
 * Owner B coverage: native compaction has two independent liveness owners, and
 * the CLI no-output watchdog is only one of them. The diagnostics stuck-session
 * recovery timer runs on its own clock and will abort a quiet run even when the
 * watchdog has deferred, so compaction must reach it too.
 *
 * Nothing here injects a `compactionActive` getter, an `onCompactionActiveChange`
 * listener, or an `onOutstandingWorkChange` double. The compaction state is
 * streamed as a backend record and the only thing carrying it to the diagnostics
 * owner is the wiring inside `executeCliProcess`, so deleting either hop turns
 * these cases red. The owner itself is the real `beginDiagnosticBackendActivity`
 * registration, observed through the same snapshot the recovery timer reads.
 */
import { afterEach, expect, it, vi } from "vitest";
import { createDeferred } from "../../../test/helpers/promise.js";
import { waitForDiagnosticEventsDrained } from "../../infra/diagnostic-events.js";
import {
  BLOCKED_TOOL_CALL_ABORT_FLOOR_MS,
  closeDiagnosticEmbeddedRunOwner,
  createDiagnosticEmbeddedRunOwner,
  getDiagnosticSessionActivitySnapshot,
  markDiagnosticEmbeddedRunStarted,
} from "../../logging/diagnostic-run-activity.js";
import { logSessionStateChange, startDiagnosticHeartbeat } from "../../logging/diagnostic.js";
import { resetDiagnosticStateForTest } from "../../logging/diagnostic.test-support.js";
import type { CliBackendParseJsonlLifecycleEvent } from "../../plugins/cli-backend.types.js";
import { buildPreparedCliRunContext } from "../cli-runner.test-helpers.js";
import { executePreparedCliRun } from "./execute.js";
import { wrapPreparedCliRunWithTestAdmission } from "./execute.test-support.js";

/** The production ceiling a resumed claude-cli turn actually runs with. */
const NO_OUTPUT_TIMEOUT_MS = 180_000;
/** Longer than the no-output budget, still inside the 15 minute work ceiling. */
const QUIET_ADVANCE_MS = 390_000;
const COMPACTION_START = { type: "system", subtype: "status", status: "compacting" };
const COMPACTION_END = { compact_result: "success" };

/** Mirrors `parseClaudeCliJsonlLifecycleEvent`; live-proven in extensions/anthropic. */
const parseJsonlLifecycleEvent: CliBackendParseJsonlLifecycleEvent = (line) => {
  if (!line.includes("compacting") && !line.includes("compact_result")) {
    return null;
  }
  const record = JSON.parse(line) as Record<string, unknown>;
  if (record.compact_result === "success" || record.compact_result === "failed") {
    return { kind: "compaction", phase: "end", completed: record.compact_result === "success" };
  }
  if (record.type === "system" && record.subtype === "status") {
    return record.status === "compacting" ? { kind: "compaction", phase: "start" } : null;
  }
  return null;
};

afterEach(() => {
  resetDiagnosticStateForTest();
  vi.useRealTimers();
});

it("holds the diagnostics recovery deadline open across a streamed compaction", async () => {
  vi.useFakeTimers({
    toFake: ["Date", "setTimeout", "clearTimeout", "setInterval", "clearInterval"],
  });
  vi.setSystemTime(Date.parse("2026-09-24T00:00:00Z"));
  const recoverStuckSession = vi.fn();
  startDiagnosticHeartbeat({ diagnostics: { enabled: true } }, { recoverStuckSession });
  const context = buildPreparedCliRunContext({
    runId: "compaction-owner-run",
    sessionId: "compaction-owner-session",
    sessionKey: "agent:main:compaction-owner",
    agentId: "main",
    model: "fixture-model",
    config: { plugins: { enabled: false } },
    timeoutMs: 1_800_000,
    backend: {
      command: process.execPath,
      sessionMode: "none",
      reliability: {
        watchdog: { fresh: { minMs: NO_OUTPUT_TIMEOUT_MS, maxMs: NO_OUTPUT_TIMEOUT_MS } },
      },
    },
  });
  context.backendResolved.bundleMcp = false;
  context.backendResolved.parseJsonlLifecycleEvent = parseJsonlLifecycleEvent;
  const started = createDeferred<number>();
  const release = createDeferred();
  const ended = createDeferred<number>();
  const finish = createDeferred();
  context.executionTarget = {
    kind: "plugin",
    async *execute() {
      yield COMPACTION_START;
      started.resolve(Date.now());
      await release.promise;
      yield COMPACTION_END;
      ended.resolve(Date.now());
      await finish.promise;
      yield { type: "result", subtype: "success", result: "compaction survived" };
    },
  };
  const owner = createDiagnosticEmbeddedRunOwner(context.params);
  context.params.diagnosticOwner = owner;
  logSessionStateChange({ ...context.params, state: "processing" });
  markDiagnosticEmbeddedRunStarted({ ...context.params, owner });

  const run = wrapPreparedCliRunWithTestAdmission(executePreparedCliRun)(context);
  try {
    const startedAt = await started.promise;
    await vi.advanceTimersByTimeAsync(QUIET_ADVANCE_MS);

    // The recovery timer owns its own clock: a deferred watchdog does not stop it.
    expect(recoverStuckSession).not.toHaveBeenCalled();
    expect(getDiagnosticSessionActivitySnapshot(context.params)).toMatchObject({
      activeBackendLivenessDeadlineAtMs: startedAt + BLOCKED_TOOL_CALL_ABORT_FLOOR_MS,
      lastProgressAgeMs: QUIET_ADVANCE_MS,
    });

    release.resolve();
    const clearedAt = await ended.promise;
    // The end record must hand the allowance back, not leave it latched open.
    expect(getDiagnosticSessionActivitySnapshot(context.params)).toMatchObject({
      activeBackendLivenessDeadlineAtMs: clearedAt + NO_OUTPUT_TIMEOUT_MS,
    });

    finish.resolve();
    await expect(run).resolves.toMatchObject({ text: "compaction survived" });
    await waitForDiagnosticEventsDrained();
    expect(
      getDiagnosticSessionActivitySnapshot(context.params).activeBackendLivenessDeadlineAtMs,
    ).toBeUndefined();
  } finally {
    release.resolve();
    finish.resolve();
    await Promise.allSettled([run]);
    closeDiagnosticEmbeddedRunOwner(owner);
  }
});

it("hands the diagnostics allowance back when a streamed compaction fails", async () => {
  vi.useFakeTimers({
    toFake: ["Date", "setTimeout", "clearTimeout", "setInterval", "clearInterval"],
  });
  vi.setSystemTime(Date.parse("2026-09-24T00:00:00Z"));
  const recoverStuckSession = vi.fn();
  startDiagnosticHeartbeat({ diagnostics: { enabled: true } }, { recoverStuckSession });
  const context = buildPreparedCliRunContext({
    runId: "compaction-owner-failed-run",
    sessionId: "compaction-owner-failed-session",
    sessionKey: "agent:main:compaction-owner-failed",
    agentId: "main",
    model: "fixture-model",
    config: { plugins: { enabled: false } },
    timeoutMs: 1_800_000,
    backend: {
      command: process.execPath,
      sessionMode: "none",
      reliability: {
        watchdog: { fresh: { minMs: NO_OUTPUT_TIMEOUT_MS, maxMs: NO_OUTPUT_TIMEOUT_MS } },
      },
    },
  });
  context.backendResolved.bundleMcp = false;
  context.backendResolved.parseJsonlLifecycleEvent = parseJsonlLifecycleEvent;
  const ended = createDeferred<number>();
  const finish = createDeferred();
  context.executionTarget = {
    kind: "plugin",
    async *execute() {
      yield COMPACTION_START;
      // A compaction that fails still ends. Only a successful result clearing the
      // allowance would leave a failed compaction holding it until the run exits.
      yield { compact_result: "failed" };
      ended.resolve(Date.now());
      await finish.promise;
      yield { type: "result", subtype: "success", result: "failed compaction released" };
    },
  };
  const owner = createDiagnosticEmbeddedRunOwner(context.params);
  context.params.diagnosticOwner = owner;
  logSessionStateChange({ ...context.params, state: "processing" });
  markDiagnosticEmbeddedRunStarted({ ...context.params, owner });

  const run = wrapPreparedCliRunWithTestAdmission(executePreparedCliRun)(context);
  try {
    const clearedAt = await ended.promise;
    expect(getDiagnosticSessionActivitySnapshot(context.params)).toMatchObject({
      activeBackendLivenessDeadlineAtMs: clearedAt + NO_OUTPUT_TIMEOUT_MS,
    });

    finish.resolve();
    await expect(run).resolves.toMatchObject({ text: "failed compaction released" });
  } finally {
    finish.resolve();
    await Promise.allSettled([run]);
    closeDiagnosticEmbeddedRunOwner(owner);
  }
});
