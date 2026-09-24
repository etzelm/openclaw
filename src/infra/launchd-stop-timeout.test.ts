import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readLaunchdStopTimeout } from "./launchd-stop-timeout.js";

const { execLaunchctl } = vi.hoisted(() => ({ execLaunchctl: vi.fn() }));
vi.mock("../daemon/launchd-exec.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../daemon/launchd-exec.js")>()),
  execLaunchctl,
}));

const LAUNCHD_ENV = { XPC_SERVICE_NAME: "ai.openclaw.gateway" };
const printed = (fields: string) => ({ code: 0, stdout: fields, stderr: "", termination: "exit" });

beforeEach(() => {
  vi.stubGlobal("process", { ...process, platform: "darwin", pid: 4242, getuid: () => 501 });
  execLaunchctl.mockReset();
});
afterEach(() => vi.unstubAllGlobals());

describe("launchd stop timeout reads the running job", () => {
  it("uses the operator job's effective exit timeout, not the template constant", async () => {
    execLaunchctl.mockResolvedValue(
      printed("\tstate = running\n\tminimum runtime = 10\n\texit timeout = 5\n\tpid = 4242\n"),
    );
    await expect(readLaunchdStopTimeout(LAUNCHD_ENV)).resolves.toEqual({
      timeoutMs: 5_000,
      source: "launchd system/ai.openclaw.gateway exit timeout",
    });
    expect(execLaunchctl).toHaveBeenCalledExactlyOnceWith(
      ["print", "system/ai.openclaw.gateway"],
      2_000,
    );
  });

  it("falls back to the gui domain when the job is not a LaunchDaemon", async () => {
    execLaunchctl
      .mockResolvedValueOnce({
        code: 113,
        stdout: "",
        stderr: "Could not find service",
        termination: "exit",
      })
      .mockResolvedValueOnce(printed("\texit timeout = 20\n\tpid = 4242\n"));
    await expect(readLaunchdStopTimeout(LAUNCHD_ENV)).resolves.toEqual({
      timeoutMs: 20_000,
      source: "launchd gui/501/ai.openclaw.gateway exit timeout",
    });
  });

  // A service account with no logged-in session has no gui domain: launchctl
  // answers 125 "Domain does not support specified action" for gui/<uid> while
  // user/<uid> prints normally. Verified on a headless macOS service account.
  it("reaches the user domain when the account has no gui session", async () => {
    execLaunchctl
      .mockResolvedValueOnce({
        code: 113,
        stdout: "",
        stderr: "Could not find service",
        termination: "exit",
      })
      .mockResolvedValueOnce({
        code: 125,
        stdout: "",
        stderr: "Domain does not support specified action",
        termination: "exit",
      })
      .mockResolvedValueOnce(printed("\texit timeout = 30\n\tpid = 4242\n"));
    await expect(readLaunchdStopTimeout(LAUNCHD_ENV)).resolves.toEqual({
      timeoutMs: 30_000,
      source: "launchd user/501/ai.openclaw.gateway exit timeout",
    });
    expect(execLaunchctl).toHaveBeenCalledTimes(3);
  });

  it("refuses a same-named job in every other domain and says why", async () => {
    execLaunchctl.mockResolvedValue(printed("\texit timeout = 300\n\tpid = 99\n"));
    const result = await readLaunchdStopTimeout(LAUNCHD_ENV);
    expect(result?.timeoutMs).toBe(20_000);
    for (const target of [
      "system/ai.openclaw.gateway",
      "gui/501/ai.openclaw.gateway",
      "user/501/ai.openclaw.gateway",
    ]) {
      expect(result?.warning).toContain(`${target}: pid 99 does not match the running process`);
    }
  });

  it.each([
    {
      result: { code: 1, stdout: "", stderr: "permission denied", termination: "exit" },
      reason: "launchctl print exited 1: permission denied",
    },
    {
      result: {
        code: 0,
        stdout: "\tstate = running\n\tpid = 4242\n",
        stderr: "",
        termination: "exit",
      },
      reason: "exit timeout is missing or invalid",
    },
    {
      result: {
        code: 0,
        stdout: "\texit timeout = not-a-number\n\tpid = 4242\n",
        stderr: "",
        termination: "exit",
      },
      reason: "exit timeout is missing or invalid",
    },
  ])("warns before using the conservative default: $reason", async ({ result, reason }) => {
    execLaunchctl.mockResolvedValue(result);
    const timeout = await readLaunchdStopTimeout(LAUNCHD_ENV);
    expect(timeout?.timeoutMs).toBe(20_000);
    expect(timeout?.source).toBe(
      "launchd ai.openclaw.gateway exit timeout unavailable; default ExitTimeOut",
    );
    expect(timeout?.warning).toContain(`system/ai.openclaw.gateway: ${reason}`);
    expect(timeout?.warning).toContain("Check the running job with launchctl print.");
  });

  it("survives launchctl throwing rather than exiting nonzero", async () => {
    execLaunchctl.mockRejectedValue(new Error("spawn ENOENT"));
    const timeout = await readLaunchdStopTimeout(LAUNCHD_ENV);
    expect(timeout?.timeoutMs).toBe(20_000);
    expect(timeout?.warning).toContain("launchctl print threw");
  });

  it("honours an explicit label override", async () => {
    execLaunchctl.mockResolvedValue(printed("\texit timeout = 45\n\tpid = 4242\n"));
    await expect(
      readLaunchdStopTimeout({ ...LAUNCHD_ENV, OPENCLAW_LAUNCHD_LABEL: "com.example.gw" }),
    ).resolves.toEqual({
      timeoutMs: 45_000,
      source: "launchd system/com.example.gw exit timeout",
    });
  });

  it("warns instead of throwing when the configured label is invalid", async () => {
    const timeout = await readLaunchdStopTimeout({
      ...LAUNCHD_ENV,
      OPENCLAW_LAUNCHD_LABEL: "bad label/../etc",
    });
    expect(timeout?.timeoutMs).toBe(20_000);
    expect(timeout?.warning).toContain("label could not be resolved");
    expect(execLaunchctl).not.toHaveBeenCalled();
  });

  it("stays out of the way when this process is not a launchd job", async () => {
    await expect(readLaunchdStopTimeout({})).resolves.toBeNull();
    expect(execLaunchctl).not.toHaveBeenCalled();
  });
});
