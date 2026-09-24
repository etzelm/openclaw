import { parseStrictPositiveInteger } from "@openclaw/normalization-core/number-coercion";
import { truncateUtf16Safe } from "@openclaw/normalization-core/utf16-slice";
import { execLaunchctl, formatLaunchctlResultDetail } from "../daemon/launchd-exec.js";
import { resolveLaunchAgentLabel } from "../daemon/launchd-label.js";
import { parseKeyValueOutput } from "../daemon/runtime-parse.js";
import { formatErrorMessage } from "./errors.js";
import {
  GATEWAY_SERVICE_STOP_TIMEOUT_MS,
  LAUNCH_AGENT_EXIT_TIMEOUT_SECONDS,
} from "./gateway-shutdown-budget.js";
import { detectRespawnSupervisor } from "./supervisor-markers.js";

export type LaunchdStopTimeout = { timeoutMs: number; source: string; warning?: string };

const LAUNCHCTL_PRINT_TIMEOUT_MS = 2_000;

/**
 * Resolve the gui domain locally. `launchd-runtime.ts` exports an equivalent,
 * but it also pulls service installation, ownership and port probing into
 * whatever imports it, and this runs on the Gateway shutdown path.
 */
function resolveLaunchdDomains(label: string): string[] {
  const uid = typeof process.getuid === "function" ? process.getuid() : 501;
  // A LaunchDaemon and a LaunchAgent can carry the same label in different
  // domains, so each is a candidate and the pid decides which one is ours.
  // A service account with no logged-in session has no gui domain at all, and
  // its per-user jobs live in `user/<uid>`, so both user domains are checked.
  return [`system/${label}`, `gui/${uid}/${label}`, `user/${uid}/${label}`];
}

/**
 * Which process the printed job actually is. The installed service can keep a
 * launcher parent while the serving Gateway runs as its child, so `launchctl
 * print` reports the launcher's pid and a bare `pid === process.pid` test would
 * reject the enforcing job. Only this process and its immediate parent qualify;
 * anything else is a same-named job in another domain.
 */
function resolveJobRelation(pid: number | undefined): "self" | "launcher" | null {
  if (pid === undefined) {
    return null;
  }
  if (pid === process.pid) {
    return "self";
  }
  return pid === process.ppid ? "launcher" : null;
}

/**
 * The job's own `state`, which `launchctl print` puts at the top of the block at
 * a single tab. The shared key-value parser cannot supply it: nested coalition
 * blocks carry their own `state = active` lines and that parser keeps the last
 * occurrence. Read against the running Gateway LaunchDaemon, `state` appears four
 * times, the job's at one tab and two coalition lines at two tabs, and the parser
 * answers `active`.
 */
function readJobState(printed: string): string | undefined {
  return /^\tstate = (?<state>.+)$/mu.exec(printed)?.groups?.state.trim();
}

/**
 * Whether launchd is the one stopping this job.
 *
 * launchd reports the job as `SIGTERMed` from the moment it begins its own stop,
 * and keeps reporting `running` while the process handles a signal that some
 * other sender delivered. Measured on macOS 27 against a job carrying
 * `ExitTimeOut` 47: `launchctl bootout` printed `state = SIGTERMed` from inside
 * the job's own SIGTERM handler and killed it at the 47 second mark, while a
 * plain `kill -TERM` printed `state = running` and left the process alive 85
 * seconds later, long past that deadline.
 *
 * Anything unrecognised counts as not stopping, so an unfamiliar state leaves the
 * Gateway on the budget it already had rather than shortening a drain that
 * launchd was never going to interrupt.
 */
function isLaunchdStoppingJob(state: string | undefined): boolean {
  return state !== undefined && /^SIG[A-Z0-9]+ed$/u.test(state);
}

/**
 * The stop deadline OpenClaw's Node recovery launcher armed for this process,
 * declared in the child environment by `node-runtime-recovery.mjs`. Being the
 * immediate parent does not establish that timer: an external process manager can
 * hold that position and run no such timer at all. Absent means there is no
 * launcher deadline to respect, so the job's own deadline stands unreduced.
 */
function readLauncherStopTimeoutMs(env: NodeJS.ProcessEnv): number | undefined {
  return parseStrictPositiveInteger(env.OPENCLAW_LAUNCHER_STOP_TIMEOUT_MS ?? "");
}

/**
 * launchd is stopping the job, so a deadline is running, but its value could not
 * be read. `LAUNCH_AGENT_EXIT_TIMEOUT_SECONDS` is both launchd's documented
 * default for a job omitting `ExitTimeOut` and the value OpenClaw's LaunchAgent
 * template writes. Guessing short only forfeits drain headroom; guessing long is
 * what lets the supervisor kill an unfinished drain.
 */
function defaultStopDeadline(target: string, reason: string): LaunchdStopTimeout {
  const timeoutMs = LAUNCH_AGENT_EXIT_TIMEOUT_SECONDS * 1_000;
  return {
    timeoutMs,
    source: `launchd ${target} exit timeout unavailable; default ExitTimeOut`,
    warning: `launchd is stopping ${target} but ${reason}; using ${timeoutMs}ms default. Check the running job with launchctl print.`,
  };
}

/**
 * The job could not be inspected, so whether launchd is stopping it is unknown.
 * Report the platform-neutral policy rather than a shorter guess: shortening here
 * would cut a drain that no launchd deadline was bounding, and the warning still
 * routes the operator to the job.
 */
function unresolved(label: string, failures: string[]): LaunchdStopTimeout {
  return {
    timeoutMs: GATEWAY_SERVICE_STOP_TIMEOUT_MS,
    source: `launchd ${label} stop state unavailable; Gateway stop policy`,
    warning: `Unable to inspect the launchd job; ${failures
      .map((failure) => truncateUtf16Safe(failure.replaceAll(/\s+/g, " "), 500))
      .join("; ")}; keeping the ${GATEWAY_SERVICE_STOP_TIMEOUT_MS}ms Gateway stop policy. Check the running job with launchctl print.`,
  };
}

/**
 * Read the stop deadline launchd is enforcing on the Gateway's own running job.
 *
 * `ExitTimeOut` bounds a stop that launchd is running and nothing else, so it is
 * adopted only while the printed job reports launchd stopping it. An operator
 * job may set any value, so `LAUNCH_AGENT_EXIT_TIMEOUT_SECONDS` is the fallback
 * rather than the answer. Returns null when this process is not a launchd job,
 * and when launchd is not the one stopping it, which leaves the caller on the
 * platform-neutral policy it already resolved.
 */
export async function readLaunchdStopTimeout(
  env: NodeJS.ProcessEnv = process.env,
): Promise<LaunchdStopTimeout | null> {
  if (detectRespawnSupervisor(env, "darwin") !== "launchd") {
    return null;
  }
  const failures: string[] = [];
  let label: string;
  try {
    label = resolveLaunchAgentLabel(env);
  } catch (error: unknown) {
    return unresolved("the configured label", [
      `label could not be resolved: ${formatErrorMessage(error)}`,
    ]);
  }
  for (const target of resolveLaunchdDomains(label)) {
    const failed = (reason: string) => failures.push(`${target}: ${reason}`);
    const result = await execLaunchctl(["print", target], LAUNCHCTL_PRINT_TIMEOUT_MS).catch(
      (error: unknown) => {
        failed(`launchctl print threw: ${formatErrorMessage(error)}`);
        return undefined;
      },
    );
    if (!result) {
      continue;
    }
    if (result.code !== 0) {
      failed(`launchctl print exited ${result.code}: ${formatLaunchctlResultDetail(result)}`);
      continue;
    }
    const printed = result.stdout || result.stderr || "";
    const entries = parseKeyValueOutput(printed, "=");
    // Adopting a deadline from a same-named job in the other domain would be
    // worse than the fallback, so the printed job must be ours.
    const pid = parseStrictPositiveInteger(entries.pid ?? "");
    const relation = resolveJobRelation(pid);
    if (!relation) {
      failed(`pid ${pid ?? "missing"} is neither this process nor its launcher`);
      continue;
    }
    // This is our job, so stop searching. Whether its deadline binds this stop is
    // a separate question from whether the job was found.
    if (!isLaunchdStoppingJob(readJobState(printed))) {
      return null;
    }
    const seconds = parseStrictPositiveInteger(entries["exit timeout"] ?? "");
    if (seconds === undefined) {
      return defaultStopDeadline(target, "its exit timeout is missing or invalid");
    }
    const jobMs = seconds * 1_000;
    // A parent that reaps this process on its own timer binds before the job's
    // ExitTimeOut, and spending the longer deadline would only get the drain
    // force-killed. Holding the parent slot does not prove that timer exists,
    // so the cap comes from OpenClaw's launcher declaring the timer it armed.
    const launcherMs = relation === "launcher" ? readLauncherStopTimeoutMs(env) : undefined;
    return launcherMs !== undefined && launcherMs < jobMs
      ? {
          timeoutMs: launcherMs,
          source: `launchd ${target} exit timeout capped at the launcher's ${launcherMs}ms stop timer`,
        }
      : { timeoutMs: jobMs, source: `launchd ${target} exit timeout` };
  }
  return unresolved(label, failures);
}
