import { performance } from "node:perf_hooks";
import { LAUNCH_AGENT_EXIT_TIMEOUT_SECONDS } from "../../daemon/launchd-plist.js";
import {
  GATEWAY_SERVICE_STOP_TIMEOUT_MS,
  GATEWAY_SHUTDOWN_RESERVE_MS,
  GATEWAY_SHUTDOWN_TIMEOUT_MS,
  GATEWAY_SUPERVISOR_EXIT_MARGIN_MS,
} from "../../infra/gateway-shutdown-budget.js";
import { readLaunchdStopTimeout } from "../../infra/launchd-stop-timeout.js";
import { readSystemdStopTimeout } from "../../infra/systemd-stop-timeout.js";

type NativeStopTimeout = { timeoutMs: number; source: string };

/**
 * Ask whichever supervisor actually enforces the deadline on this platform.
 *
 * `stop` and `warning` are independent answers. A probe that could not establish
 * a deadline still has something to tell the operator, and only a non-null `stop`
 * may be spent as a native stop budget.
 */
async function readNativeStopTimeout(
  stopping: boolean,
): Promise<{ stop: NativeStopTimeout | null; warning?: string }> {
  if (process.platform === "linux") {
    const systemd = await readSystemdStopTimeout();
    return { stop: systemd, warning: systemd?.warning };
  }
  // launchd's ExitTimeOut bounds a stop that launchd is running and nothing else:
  // an externally delivered SIGTERM never starts that clock, and the job outlives
  // the deadline untouched. There is no enforcing deadline to read before a stop
  // is under way, and reading one at startup would spend a launchctl print only
  // to adopt a deadline that does not govern the stop the Gateway will get.
  if (process.platform === "darwin" && stopping) {
    return await readLaunchdStopTimeout();
  }
  return { stop: null };
}

export async function resolveGatewayShutdownBudget(
  supervisor: string | null,
  logger: { info(message: string): void; warn(message: string): void },
  refresh?: {
    previous: { timeoutMs: number; nativeStopBudget: boolean };
    acceptedAtMs: number;
  },
) {
  // Restart ownership may be external while the platform supervisor still
  // enforces the stop deadline. That holds on darwin exactly as it does on linux.
  const native = await readNativeStopTimeout(refresh !== undefined);
  const nativeStop = native.stop;
  const retained =
    refresh?.previous.nativeStopBudget && (!nativeStop || native.warning)
      ? refresh.previous
      : undefined;
  if (native.warning) {
    logger.warn(native.warning);
  }
  if (retained) {
    logger.warn(
      `Retaining the startup shutdown budget of ${retained.timeoutMs}ms because the current supervisor stop timeout could not be confirmed.`,
    );
  }
  const stop = nativeStop ?? {
    timeoutMs:
      supervisor === "launchd"
        ? LAUNCH_AGENT_EXIT_TIMEOUT_SECONDS * 1_000
        : GATEWAY_SERVICE_STOP_TIMEOUT_MS,
    source: supervisor === "launchd" ? "launchd ExitTimeOut" : "Gateway stop policy",
  };
  const nativeStopBudget = nativeStop !== null || supervisor === "launchd" || Boolean(retained);
  const limitMs =
    retained?.timeoutMs ??
    Math.min(GATEWAY_SHUTDOWN_TIMEOUT_MS, stop.timeoutMs - GATEWAY_SUPERVISOR_EXIT_MARGIN_MS);
  const elapsedMs =
    refresh && nativeStopBudget
      ? Math.max(0, Math.ceil(performance.now() - refresh.acceptedAtMs))
      : 0;
  const timeoutMs = Math.max(0, limitMs - elapsedMs);
  const reserveMs = Math.min(GATEWAY_SHUTDOWN_RESERVE_MS, timeoutMs);
  return {
    nativeStopBudget,
    timeoutMs,
    reserveMs,
    // Let cleanup failures reach the run loop before its native exit timer wins.
    cleanupBudget: (deadline: number | undefined, hardExitGraceMs: number) =>
      deadline === undefined
        ? undefined
        : {
            deadline:
              deadline -
              Math.min(hardExitGraceMs / 2, Math.max(0, deadline - performance.now()) / 2),
            warn: (message: string) => logger.warn(message),
          },
    log: (phase: "startup" | "shutdown") => {
      logger.info(
        `shutdown budget at ${phase}: drain=${Math.max(0, timeoutMs - GATEWAY_SHUTDOWN_RESERVE_MS)}ms shutdown=${timeoutMs}ms reserve=${reserveMs}ms exitMargin=${GATEWAY_SUPERVISOR_EXIT_MARGIN_MS}ms; source=${retained ? `startup shutdown budget=${retained.timeoutMs}ms` : `${stop.source}=${stop.timeoutMs}ms`}`,
      );
    },
  };
}

export function resolveGatewayShutdownDrainBudget(params: {
  budget: { nativeStopBudget: boolean; timeoutMs: number; reserveMs: number };
  isRestart: boolean;
  forceRestart: boolean;
  restartWithoutSupervisor: boolean;
  acceptedAtMs: number;
  requestedRestartDrainTimeoutMs?: number;
}) {
  const { budget, isRestart } = params;
  const requested = params.requestedRestartDrainTimeoutMs;
  const elapsedMs = performance.now() - params.acceptedAtMs;
  const remaining = requested === undefined ? undefined : Math.max(0, requested - elapsedMs);
  const restartDrainTimeoutMs = budget.nativeStopBudget
    ? Math.min(remaining ?? Infinity, Math.max(0, budget.timeoutMs - budget.reserveMs))
    : remaining;
  const restartDrainDeadlineAt =
    isRestart && restartDrainTimeoutMs !== undefined
      ? Date.now() + restartDrainTimeoutMs
      : undefined;
  const forcedRestartDeadlineAt =
    params.forceRestart && restartDrainDeadlineAt !== undefined
      ? restartDrainDeadlineAt + budget.reserveMs
      : undefined;
  const restartTimeoutMs = (drainTimeoutMs: number) => {
    if (forcedRestartDeadlineAt !== undefined) {
      return Math.max(0, forcedRestartDeadlineAt - Date.now());
    }
    // A containing service can bound an in-process restart without replacing it.
    return budget.nativeStopBudget && params.restartWithoutSupervisor
      ? budget.timeoutMs
      : drainTimeoutMs + (budget.nativeStopBudget ? budget.reserveMs : GATEWAY_SHUTDOWN_TIMEOUT_MS);
  };
  return {
    restartDrainDeadlineAt,
    restartTimeoutMs: () =>
      budget.nativeStopBudget || params.forceRestart
        ? restartTimeoutMs(Math.max(0, (restartDrainDeadlineAt ?? Date.now()) - Date.now()))
        : GATEWAY_SHUTDOWN_TIMEOUT_MS,
    closeDrainTimeoutMs: () =>
      restartDrainTimeoutMs === undefined
        ? GATEWAY_SHUTDOWN_TIMEOUT_MS - budget.reserveMs
        : Math.max(0, (restartDrainDeadlineAt ?? Date.now()) - Date.now()),
    drainTimeoutMs: isRestart
      ? restartDrainTimeoutMs
      : Math.max(0, budget.timeoutMs - budget.reserveMs),
    forceExitMs: !isRestart
      ? budget.timeoutMs
      : restartDrainTimeoutMs === undefined
        ? undefined
        : restartTimeoutMs(restartDrainTimeoutMs),
  };
}
