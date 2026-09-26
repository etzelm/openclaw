import { type CliTimeoutContext, FailoverError } from "../failover-error.js";
import { createCliFailoverError } from "./exit-error.js";

type CliNoOutputTimeoutPolicyParams = {
  context: Pick<FailoverError, "provider" | "model" | "sessionId" | "lane">;
  cliTimeout: CliTimeoutContext;
  timeoutMs: number;
  quietDurationMs: number;
  hasOutputText: boolean;
  useResume: boolean;
  hasReplayUnsafeActivity: boolean;
  allowResumeControlOnlyRetry?: boolean;
  outstandingWorkGraceMs?: number;
  compactionGraceMs?: number;
};

// Compaction on its own is a single summarization call, so it caps the grace at its
// own narrower ceiling instead of holding the blocked-tool floor. Concurrent tool or
// background work keeps the wider floor that work already had.
function resolveOutstandingWorkGraceMs(
  params: Pick<CliNoOutputTimeoutPolicyParams, "outstandingWorkGraceMs" | "compactionGraceMs">,
  toolWork: boolean,
): number | undefined {
  if (params.outstandingWorkGraceMs === undefined || toolWork) {
    return params.outstandingWorkGraceMs;
  }
  return params.compactionGraceMs === undefined
    ? params.outstandingWorkGraceMs
    : Math.min(params.outstandingWorkGraceMs, params.compactionGraceMs);
}

export const isReplaySafeCliResumeControlOnly = (useResume: boolean, ...unsafe: boolean[]) =>
  useResume && !unsafe.some(Boolean);
export function resolveCliNoOutputTimeoutDecision(params: CliNoOutputTimeoutPolicyParams): {
  deferMs?: number;
  error: FailoverError;
} {
  const toolWork = params.cliTimeout.activeToolCount + params.cliTimeout.backgroundTaskCount > 0;
  const outstandingWork = toolWork || params.cliTimeout.compactionActive === true;
  const graceMs = resolveOutstandingWorkGraceMs(params, toolWork);
  const deferMs =
    outstandingWork && graceMs !== undefined
      ? Math.max(params.timeoutMs, graceMs) - params.quietDurationMs
      : undefined;
  const retryable =
    (!params.cliTimeout.observedActivity && !params.hasOutputText) ||
    (params.allowResumeControlOnlyRetry === true &&
      isReplaySafeCliResumeControlOnly(
        params.useResume,
        params.hasOutputText,
        params.hasReplayUnsafeActivity,
        outstandingWork,
      ));
  return {
    ...(deferMs !== undefined && deferMs > 0 ? { deferMs } : {}),
    error: createCliTimeoutError(
      params.context,
      params.cliTimeout,
      retryable ? "cli_no_output_timeout" : undefined,
    ),
  };
}

export function createCliTimeoutError(
  context: Pick<FailoverError, "provider" | "model" | "sessionId" | "lane">,
  cliTimeout: CliTimeoutContext,
  code?: string,
): FailoverError {
  return createCliFailoverError(
    cliTimeout.mode === "no-output"
      ? `CLI produced no output for ${cliTimeout.timeoutSeconds}s and was terminated.`
      : `CLI exceeded timeout (${cliTimeout.timeoutSeconds}s) and was terminated.`,
    "timeout",
    context,
    { code, cliTimeout, timeout: { timeoutPhase: "provider" } },
  );
}
