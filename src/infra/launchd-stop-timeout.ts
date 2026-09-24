import { parseStrictPositiveInteger } from "@openclaw/normalization-core/number-coercion";
import { truncateUtf16Safe } from "@openclaw/normalization-core/utf16-slice";
import { execLaunchctl, formatLaunchctlResultDetail } from "../daemon/launchd-exec.js";
import { resolveLaunchAgentLabel } from "../daemon/launchd-label.js";
import { parseKeyValueOutput } from "../daemon/runtime-parse.js";
import { formatErrorMessage } from "./errors.js";
import { LAUNCH_AGENT_EXIT_TIMEOUT_SECONDS } from "./gateway-shutdown-budget.js";
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
 * launchd's own documented default when a job omits ExitTimeOut, and the value
 * OpenClaw's LaunchAgent template writes. Guessing short only forfeits drain
 * headroom; guessing long is what lets the supervisor kill an unfinished drain.
 */
function fallback(label: string, failures: string[]): LaunchdStopTimeout {
  const timeoutMs = LAUNCH_AGENT_EXIT_TIMEOUT_SECONDS * 1_000;
  return {
    timeoutMs,
    source: `launchd ${label} exit timeout unavailable; default ExitTimeOut`,
    warning: `Unable to read the launchd exit timeout; ${failures
      .map((failure) => truncateUtf16Safe(failure.replaceAll(/\s+/g, " "), 500))
      .join("; ")}; using ${timeoutMs}ms default. Check the running job with launchctl print.`,
  };
}

/**
 * Read the stop deadline launchd enforces on the Gateway's own running job.
 *
 * ExitTimeOut is readable only from the loaded job, and an operator-authored
 * job may set any value, so `LAUNCH_AGENT_EXIT_TIMEOUT_SECONDS` is the fallback
 * rather than the answer. Returns null when this process is not a launchd job,
 * which leaves the caller on its platform-neutral policy.
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
    return fallback("the configured label", [
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
    const entries = parseKeyValueOutput(result.stdout || result.stderr || "", "=");
    // Adopting a deadline from a same-named job in the other domain would be
    // worse than the fallback, so the printed job must be ours.
    const pid = parseStrictPositiveInteger(entries.pid ?? "");
    const relation = resolveJobRelation(pid);
    if (!relation) {
      failed(`pid ${pid ?? "missing"} is neither this process nor its launcher`);
      continue;
    }
    const seconds = parseStrictPositiveInteger(entries["exit timeout"] ?? "");
    if (seconds !== undefined) {
      const jobMs = seconds * 1_000;
      // A launcher parent reaps this process on its own timer, and that timer is
      // built from LAUNCH_AGENT_EXIT_TIMEOUT_SECONDS rather than from the job's
      // ExitTimeOut. Spending a longer operator deadline would only get the
      // drain force-killed by our own parent, so take whichever binds first.
      const launcherMs = LAUNCH_AGENT_EXIT_TIMEOUT_SECONDS * 1_000;
      return relation === "self" || jobMs <= launcherMs
        ? { timeoutMs: jobMs, source: `launchd ${target} exit timeout` }
        : {
            timeoutMs: launcherMs,
            source: `launchd ${target} exit timeout capped at the launcher's ${launcherMs}ms stop timer`,
          };
    }
    failed("exit timeout is missing or invalid");
  }
  return fallback(label, failures);
}
