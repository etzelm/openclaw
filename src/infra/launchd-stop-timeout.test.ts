import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readLaunchdStopTimeout } from "./launchd-stop-timeout.js";

const { execLaunchctl } = vi.hoisted(() => ({ execLaunchctl: vi.fn() }));
vi.mock("../daemon/launchd-exec.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../daemon/launchd-exec.js")>()),
  execLaunchctl,
}));

const LAUNCHD_ENV = { XPC_SERVICE_NAME: "ai.openclaw.gateway" };
const LAUNCHER_ENV = { ...LAUNCHD_ENV, OPENCLAW_LAUNCHER_STOP_TIMEOUT_MS: "19000" };
const result = (stdout: string) => ({ code: 0, stdout, stderr: "", termination: "exit" });

/**
 * Shaped like real `launchctl print` output rather than a bare field list: the
 * job's own `state` at one tab, then coalition blocks carrying their own
 * `state = active` at two tabs, then `job state`. A live Gateway LaunchDaemon
 * prints `state` four times in exactly this arrangement.
 */
const printed = (state: string, fields: string) =>
  result(
    `system/ai.openclaw.gateway = {\n\tactive count = 1\n\ttype = LaunchDaemon\n\tstate = ${state}\n\n${fields}\tresource coalition = {\n\t\tID = 18110\n\t\tstate = active\n\t}\n\n\tjetsam coalition = {\n\t\tID = 18111\n\t\tstate = active\n\t}\n\n\tjob state = running\n}\n`,
  );
const stopping = (fields: string) => printed("SIGTERMed", fields);

beforeEach(() => {
  vi.stubGlobal("process", {
    ...process,
    platform: "darwin",
    pid: 4242,
    ppid: 4241,
    getuid: () => 501,
  });
  execLaunchctl.mockReset();
});
afterEach(() => vi.unstubAllGlobals());

describe("launchd stop timeout reads the job launchd is stopping", () => {
  it("uses the operator job's effective exit timeout, not the template constant", async () => {
    execLaunchctl.mockResolvedValue(
      stopping("\tminimum runtime = 10\n\texit timeout = 5\n\tpid = 4242\n"),
    );
    await expect(readLaunchdStopTimeout(LAUNCHD_ENV)).resolves.toEqual({
      stop: { timeoutMs: 5_000, source: "launchd system/ai.openclaw.gateway exit timeout" },
    });
    expect(execLaunchctl).toHaveBeenCalledExactlyOnceWith(
      ["print", "system/ai.openclaw.gateway"],
      2_000,
    );
  });

  // The shared key-value parser keeps the LAST occurrence of a repeated key, and
  // `launchctl print` repeats `state` inside coalition blocks, so asking it for
  // `state` answers `active` and never sees the job at all. This case fails if
  // the reader ever goes back to that parser for the job's state.
  it("reads the job's own state, not a nested coalition's", async () => {
    execLaunchctl.mockResolvedValue(stopping("\texit timeout = 47\n\tpid = 4242\n"));
    await expect(readLaunchdStopTimeout(LAUNCHD_ENV)).resolves.toEqual({
      stop: { timeoutMs: 47_000, source: "launchd system/ai.openclaw.gateway exit timeout" },
    });
  });

  // Measured on macOS 27 with ExitTimeOut 47: a plain `kill -TERM` left the job
  // printing `state = running` while the process handled the signal, and it was
  // still alive 85 seconds later. launchd never started its clock, so its
  // deadline bounds nothing and the caller keeps the budget it already had.
  it("declines the deadline when launchd is not the one stopping the job", async () => {
    execLaunchctl.mockResolvedValue(printed("running", "\texit timeout = 5\n\tpid = 4242\n"));
    // No deadline and nothing to warn about: this is the ordinary shape of a stop
    // that some other sender delivered.
    await expect(readLaunchdStopTimeout(LAUNCHD_ENV)).resolves.toEqual({ stop: null });
    // Our job was found in the first domain, so there is nothing left to search.
    expect(execLaunchctl).toHaveBeenCalledTimes(1);
  });

  it.each(["waiting", "exited", "not running", "SIGTERM", "sigtermed", ""])(
    "treats the unrecognised state %j as not stopping",
    async (state) => {
      execLaunchctl.mockResolvedValue(printed(state, "\texit timeout = 5\n\tpid = 4242\n"));
      await expect(readLaunchdStopTimeout(LAUNCHD_ENV)).resolves.toEqual({ stop: null });
    },
  );

  it("accepts any signal launchd reports having delivered", async () => {
    execLaunchctl.mockResolvedValue(printed("SIGKILLed", "\texit timeout = 9\n\tpid = 4242\n"));
    await expect(readLaunchdStopTimeout(LAUNCHD_ENV)).resolves.toEqual({
      stop: { timeoutMs: 9_000, source: "launchd system/ai.openclaw.gateway exit timeout" },
    });
  });

  it("falls back to the gui domain when the job is not a LaunchDaemon", async () => {
    execLaunchctl
      .mockResolvedValueOnce({
        code: 113,
        stdout: "",
        stderr: "Could not find service",
        termination: "exit",
      })
      .mockResolvedValueOnce(stopping("\texit timeout = 20\n\tpid = 4242\n"));
    await expect(readLaunchdStopTimeout(LAUNCHD_ENV)).resolves.toEqual({
      stop: { timeoutMs: 20_000, source: "launchd gui/501/ai.openclaw.gateway exit timeout" },
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
      .mockResolvedValueOnce(stopping("\texit timeout = 30\n\tpid = 4242\n"));
    await expect(readLaunchdStopTimeout(LAUNCHD_ENV)).resolves.toEqual({
      stop: { timeoutMs: 30_000, source: "launchd user/501/ai.openclaw.gateway exit timeout" },
    });
    expect(execLaunchctl).toHaveBeenCalledTimes(3);
  });

  it("refuses a same-named job in every other domain and says why", async () => {
    execLaunchctl.mockResolvedValue(stopping("\texit timeout = 300\n\tpid = 99\n"));
    const read = await readLaunchdStopTimeout(LAUNCHD_ENV);
    // Nothing was established, so no deadline is reported at all and the caller
    // keeps the platform-neutral policy it already resolved.
    expect(read.stop).toBeNull();
    for (const target of [
      "system/ai.openclaw.gateway",
      "gui/501/ai.openclaw.gateway",
      "user/501/ai.openclaw.gateway",
    ]) {
      expect(read.warning).toContain(
        `${target}: pid 99 is neither this process nor its launcher`,
      );
    }
  });

  // The installed service can keep a launcher parent while the serving Gateway
  // runs as its child, so the job prints the launcher's pid. Requiring
  // pid === process.pid there would reject the job that enforces the deadline.
  it("accepts the job when it is this process's launcher parent", async () => {
    execLaunchctl.mockResolvedValue(stopping("\texit timeout = 12\n\tpid = 4241\n"));
    await expect(readLaunchdStopTimeout(LAUNCHD_ENV)).resolves.toEqual({
      stop: { timeoutMs: 12_000, source: "launchd system/ai.openclaw.gateway exit timeout" },
    });
  });

  // node-runtime-recovery.mjs declares the reap timer it armed. A longer operator
  // deadline cannot be spent under it: the parent force-kills this process first.
  it("caps a declared launcher deadline that binds before the job's", async () => {
    execLaunchctl.mockResolvedValue(stopping("\texit timeout = 90\n\tpid = 4241\n"));
    await expect(readLaunchdStopTimeout(LAUNCHER_ENV)).resolves.toEqual({
      stop: {
        timeoutMs: 19_000,
        source:
          "launchd system/ai.openclaw.gateway exit timeout capped at the launcher's 19000ms stop timer",
      },
    });
  });

  // Holding the parent slot is not evidence of a reap timer: an external process
  // manager can sit there and run none. Capping it at OpenClaw's launcher timer
  // would cut a valid drain short, so an undeclared parent caps nothing.
  it("leaves an undeclared parent's longer job deadline intact", async () => {
    execLaunchctl.mockResolvedValue(stopping("\texit timeout = 90\n\tpid = 4241\n"));
    await expect(readLaunchdStopTimeout(LAUNCHD_ENV)).resolves.toEqual({
      stop: { timeoutMs: 90_000, source: "launchd system/ai.openclaw.gateway exit timeout" },
    });
  });

  it.each(["", "   ", "not-a-number", "0", "-5"])(
    "ignores a malformed launcher declaration %j",
    async (declared) => {
      execLaunchctl.mockResolvedValue(stopping("\texit timeout = 90\n\tpid = 4241\n"));
      await expect(
        readLaunchdStopTimeout({ ...LAUNCHD_ENV, OPENCLAW_LAUNCHER_STOP_TIMEOUT_MS: declared }),
      ).resolves.toEqual({
        stop: { timeoutMs: 90_000, source: "launchd system/ai.openclaw.gateway exit timeout" },
      });
    },
  );

  // launchd reaps the whole job first, so a shorter job deadline still wins.
  it("keeps a job deadline shorter than the declared launcher timer", async () => {
    execLaunchctl.mockResolvedValue(stopping("\texit timeout = 5\n\tpid = 4241\n"));
    await expect(readLaunchdStopTimeout(LAUNCHER_ENV)).resolves.toEqual({
      stop: { timeoutMs: 5_000, source: "launchd system/ai.openclaw.gateway exit timeout" },
    });
  });

  // The declaration is scoped to the parent that made it, so an inherited or
  // spoofed value cannot shorten the budget of a Gateway that is the job itself.
  it("ignores a declared launcher timer when this process is the job", async () => {
    execLaunchctl.mockResolvedValue(stopping("\texit timeout = 90\n\tpid = 4242\n"));
    await expect(
      readLaunchdStopTimeout({ ...LAUNCHD_ENV, OPENCLAW_LAUNCHER_STOP_TIMEOUT_MS: "1000" }),
    ).resolves.toEqual({
      stop: { timeoutMs: 90_000, source: "launchd system/ai.openclaw.gateway exit timeout" },
    });
  });

  // launchd is stopping the job, so a deadline is running even though its value
  // is unreadable. Guess short here: guessing long is what lets the drain die.
  it.each(["\tpid = 4242\n", "\texit timeout = not-a-number\n\tpid = 4242\n"])(
    "uses the conservative default when a running stop has no readable deadline",
    async (fields) => {
      execLaunchctl.mockResolvedValue(stopping(fields));
      const read = await readLaunchdStopTimeout(LAUNCHD_ENV);
      // A deadline IS running here, so this one is a real native budget even
      // though its value had to be defaulted.
      expect(read.stop?.timeoutMs).toBe(20_000);
      expect(read.stop?.source).toBe(
        "launchd system/ai.openclaw.gateway exit timeout unavailable; default ExitTimeOut",
      );
      expect(read.warning).toContain(
        "launchd is stopping system/ai.openclaw.gateway but its exit timeout is missing or invalid",
      );
    },
  );

  // THE REGRESSION GUARD for the failed-inspection path. A probe that established
  // nothing must report no deadline: handing back the Gateway's own stop policy
  // here is what let the caller classify an unverified number as a native stop
  // budget, capping a longer requested restart drain and arming a forced exit.
  it("reports no deadline when the job cannot be inspected", async () => {
    execLaunchctl.mockResolvedValue({
      code: 1,
      stdout: "",
      stderr: "permission denied",
      termination: "exit",
    });
    const read = await readLaunchdStopTimeout(LAUNCHD_ENV);
    expect(read.stop).toBeNull();
    expect(read.warning).toContain(
      "system/ai.openclaw.gateway: launchctl print exited 1: permission denied",
    );
    expect(read.warning).toContain("keeping the Gateway stop policy");
    expect(read.warning).toContain("Check the running job with launchctl print.");
  });

  it("survives launchctl throwing rather than exiting nonzero", async () => {
    execLaunchctl.mockRejectedValue(new Error("spawn ENOENT"));
    const read = await readLaunchdStopTimeout(LAUNCHD_ENV);
    expect(read.stop).toBeNull();
    expect(read.warning).toContain("launchctl print threw");
  });

  it("honours an explicit label override", async () => {
    execLaunchctl.mockResolvedValue(stopping("\texit timeout = 45\n\tpid = 4242\n"));
    await expect(
      readLaunchdStopTimeout({ ...LAUNCHD_ENV, OPENCLAW_LAUNCHD_LABEL: "com.example.gw" }),
    ).resolves.toEqual({
      stop: { timeoutMs: 45_000, source: "launchd system/com.example.gw exit timeout" },
    });
  });

  it("warns instead of throwing when the configured label is invalid", async () => {
    const read = await readLaunchdStopTimeout({
      ...LAUNCHD_ENV,
      OPENCLAW_LAUNCHD_LABEL: "bad label/../etc",
    });
    expect(read.stop).toBeNull();
    expect(read.warning).toContain("label could not be resolved");
    expect(execLaunchctl).not.toHaveBeenCalled();
  });

  it("stays out of the way when this process is not a launchd job", async () => {
    await expect(readLaunchdStopTimeout({})).resolves.toEqual({ stop: null });
    expect(execLaunchctl).not.toHaveBeenCalled();
  });
});
