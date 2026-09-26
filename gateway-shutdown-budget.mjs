// Shared stop policy; v2026.9.5 restart-health.constants.ts fixes the replacement window.
export const GATEWAY_RESTART_REPLACEMENT_TIMEOUT_MS = 60_000;
const GATEWAY_SHUTDOWN_DRAIN_TIMEOUT_MS = 315_000;
export const GATEWAY_SHUTDOWN_RESERVE_MS = 10_000;
export const GATEWAY_SUPERVISOR_EXIT_MARGIN_MS = 5_000;
export const GATEWAY_SHUTDOWN_TIMEOUT_MS =
  GATEWAY_SHUTDOWN_DRAIN_TIMEOUT_MS + GATEWAY_SHUTDOWN_RESERVE_MS;
export const GATEWAY_SERVICE_STOP_TIMEOUT_MS =
  GATEWAY_SHUTDOWN_TIMEOUT_MS + GATEWAY_SUPERVISOR_EXIT_MARGIN_MS;

export const LAUNCH_AGENT_EXIT_TIMEOUT_SECONDS = 20;

/**
 * The share of a deadline each fixed allowance may take when the deadline is too
 * short to fund it outright.
 *
 * `GATEWAY_SHUTDOWN_RESERVE_MS` and `GATEWAY_SUPERVISOR_EXIT_MARGIN_MS` were sized
 * against the 315 second policy drain, where both are rounding error. A launchd job
 * may enforce any `ExitTimeOut`, and subtracting fixed allowances from a short one
 * leaves active work nothing: the margin alone consumes a 5 second deadline whole,
 * and margin plus reserve consume 15 seconds, so drain reached zero well before the
 * deadline itself did. Capping each allowance at a share of what it is carved from
 * keeps the full allowance once the deadline can afford it and otherwise leaves
 * drain a proportional slice, so drain rises with `ExitTimeOut` and stays positive
 * for every positive deadline.
 */
export const GATEWAY_SUPERVISOR_EXIT_MARGIN_SHARE = 0.25;
export const GATEWAY_SHUTDOWN_RESERVE_SHARE = 0.5;

/** The exit margin to hold back from a supervisor-enforced stop deadline. */
export const resolveSupervisorExitMarginMs = (stopTimeoutMs) =>
  Math.min(
    GATEWAY_SUPERVISOR_EXIT_MARGIN_MS,
    Math.floor(Math.max(0, stopTimeoutMs) * GATEWAY_SUPERVISOR_EXIT_MARGIN_SHARE),
  );

/** The post-drain reserve to hold back from a resolved shutdown budget. */
export const resolveShutdownReserveMs = (shutdownTimeoutMs) =>
  Math.min(
    GATEWAY_SHUTDOWN_RESERVE_MS,
    Math.floor(Math.max(0, shutdownTimeoutMs) * GATEWAY_SHUTDOWN_RESERVE_SHARE),
  );

// Escalation graces the Node recovery launcher applies to a stopping child. Kept
// here rather than in the launcher so the serving Gateway can derive the deadline
// its parent enforces from the same numbers the parent armed it from.
export const RESPAWN_SIGNAL_EXIT_GRACE_MS = 1_000;
export const RESPAWN_SIGNAL_FORCE_KILL_GRACE_MS = 1_000;
export const RESPAWN_SIGNAL_HARD_EXIT_GRACE_MS = 1_000;

/**
 * The stop deadline the containing service imposes on a respawning launcher.
 *
 * A launchd job running OpenClaw's own label is bounded by the LaunchAgent
 * template's `ExitTimeOut`; anything else falls back to the platform-neutral stop
 * policy. The launcher reads this from its own environment, and a respawned child
 * inherits that environment unchanged, so both answer identically.
 */
export const resolveRespawnServiceStopTimeoutMs = (env, platform) => {
  const launchdService = env.OPENCLAW_LAUNCHD_LABEL?.trim();
  return platform === "darwin" && launchdService && env.XPC_SERVICE_NAME === launchdService
    ? LAUNCH_AGENT_EXIT_TIMEOUT_SECONDS * 1_000
    : GATEWAY_SERVICE_STOP_TIMEOUT_MS;
};

/**
 * The deadline the Node recovery launcher enforces on the Gateway it respawned.
 *
 * The launcher forwards the stop signal, waits out the exit grace, then force-kills
 * one force-kill grace later, so that sum is the deadline the child actually gets.
 * `foreground` mirrors the launcher's own argv test, and a respawned child carries
 * the same user arguments, so the child reproduces the launcher's answer from its
 * own argv without the launcher having to declare it.
 */
export const resolveLauncherStopTimeoutMs = ({ env, platform, foreground }) => {
  const serviceStopTimeoutMs = resolveRespawnServiceStopTimeoutMs(env, platform);
  const signalExitGraceMs =
    platform !== "win32" && foreground
      ? serviceStopTimeoutMs -
        RESPAWN_SIGNAL_FORCE_KILL_GRACE_MS -
        RESPAWN_SIGNAL_HARD_EXIT_GRACE_MS
      : RESPAWN_SIGNAL_EXIT_GRACE_MS;
  return signalExitGraceMs + RESPAWN_SIGNAL_FORCE_KILL_GRACE_MS;
};
