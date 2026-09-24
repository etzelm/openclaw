import { performance } from "node:perf_hooks";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  resolveGatewayShutdownBudget,
  resolveGatewayShutdownDrainBudget,
} from "./run-loop-shutdown-budget.js";

const { readFile, execUser, execSystem, execLaunchctl } = vi.hoisted(() => ({
  readFile: vi.fn(),
  execUser: vi.fn(),
  execSystem: vi.fn(),
  execLaunchctl: vi.fn(),
}));
vi.mock("node:fs/promises", () => ({ default: { readFile } }));
vi.mock("../../daemon/systemd-exec.js", () => ({
  execSystemctlUser: execUser,
  execSystemctl: execSystem,
}));
vi.mock("../../daemon/launchd-exec.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../daemon/launchd-exec.js")>()),
  execLaunchctl,
}));

beforeEach(() => {
  vi.stubGlobal("process", { ...process, platform: "linux", getuid: () => 1000, env: {} });
  readFile.mockReset().mockResolvedValue("0::/system.slice/openclaw-gateway.service\n");
  execUser.mockReset().mockResolvedValue({ code: 1, stdout: "", stderr: "No user bus" });
  execSystem.mockReset().mockResolvedValue({
    code: 0,
    stdout:
      "LoadState=loaded\nTimeoutStopUSec=1min 30s\nInvocationID=own\n" +
      "User=openclaw\nType=simple\nNotifyAccess=none\nKillMode=control-group",
    stderr: "",
  });
  execLaunchctl.mockReset();
});
afterEach(() => vi.unstubAllGlobals());

describe("Gateway stop deadline independent of restart ownership", () => {
  it.each(["own", undefined])(
    "clamps an external system unit running as a service user (invocation=%s)",
    async (invocation) => {
      process.env.OPENCLAW_SUPERVISOR_MODE = "external";
      if (invocation) {
        process.env.INVOCATION_ID = invocation;
      }
      const info = vi.fn();
      const budget = await resolveGatewayShutdownBudget("external", { info, warn: vi.fn() });
      budget.log("startup");
      expect(info).toHaveBeenCalledWith(
        "shutdown budget at startup: drain=75000ms shutdown=85000ms reserve=10000ms exitMargin=5000ms; source=systemd system openclaw-gateway.service TimeoutStopUSec=90000ms",
      );
      expect(budget.timeoutMs).toBe(85_000);
      expect(budget.nativeStopBudget).toBe(true);
      expect(execSystem).toHaveBeenCalled();
      expect(execUser).not.toHaveBeenCalled();
    },
  );

  it.each([
    {
      result: { code: 1, stdout: "", stderr: "permission denied" },
      reason: "systemctl show exited 1: permission denied",
    },
    {
      result: { code: 0, stdout: "LoadState=not-found", stderr: "" },
      reason: "LoadState=not-found",
    },
    {
      result: {
        code: 0,
        stdout: "LoadState=loaded\nTimeoutStopUSec=10min\nInvocationID=other",
        stderr: "",
      },
      reason: "InvocationID does not match",
    },
    {
      result: { code: 0, stdout: "LoadState=loaded\nInvocationID=own", stderr: "" },
      reason: "TimeoutStopUSec is missing or invalid",
    },
  ])("warns before using a conservative fallback: $reason", async ({ result, reason }) => {
    process.env.INVOCATION_ID = "own";
    execSystem.mockResolvedValue(result);
    const warn = vi.fn();
    const budget = await resolveGatewayShutdownBudget("external", { info: vi.fn(), warn });
    expect(budget.timeoutMs).toBe(85_000);
    expect(warn).toHaveBeenCalledExactlyOnceWith(
      expect.stringContaining(`system manager openclaw-gateway.service: ${reason}`),
    );
    expect(execUser).not.toHaveBeenCalled();
  });

  it.each([
    "0::/\n",
    "0::/user.slice/user-1000.slice/user@1000.service/app.slice/terminal.scope\n",
  ])("keeps the normal budget outside a service (%s)", async (membership) => {
    readFile.mockResolvedValue(membership);
    const warn = vi.fn();
    const budget = await resolveGatewayShutdownBudget(null, { info: vi.fn(), warn });
    expect(budget.timeoutMs).toBe(325_000);
    expect(budget.nativeStopBudget).toBe(false);
    expect(warn).not.toHaveBeenCalled();
    expect(execSystem).not.toHaveBeenCalled();
    expect(execUser).not.toHaveBeenCalled();
  });
});

describe("Gateway stop deadline follows the launchd stop that is actually running", () => {
  // A stop that is under way. `previous` is the startup budget a darwin Gateway
  // resolves before any stop exists, which is the platform-neutral policy.
  // The budget subtracts `performance.now() - acceptedAtMs` and floors it at
  // zero, so an acceptance stamped ahead of the clock records exactly no elapsed
  // time and keeps the asserted numbers exact instead of off by a stray
  // millisecond.
  const stoppingNow = {
    previous: { timeoutMs: 325_000, nativeStopBudget: false },
    acceptedAtMs: Number.MAX_SAFE_INTEGER,
  };
  const printed = (state: string, fields: string) => ({
    code: 0,
    stdout: `system/ai.openclaw.gateway = {\n\tstate = ${state}\n\n${fields}\tresource coalition = {\n\t\tstate = active\n\t}\n}\n`,
    stderr: "",
    termination: "exit",
  });

  beforeEach(() => {
    vi.stubGlobal("process", {
      ...process,
      platform: "darwin",
      pid: 4242,
      getuid: () => 501,
      env: {},
    });
    process.env.XPC_SERVICE_NAME = "ai.openclaw.gateway";
    process.env.OPENCLAW_SUPERVISOR_MODE = "external";
  });

  // THE REGRESSION GUARD. The linked report is an externally delivered SIGTERM
  // under a five second job, where launchd never starts its clock and active work
  // drained for 315 seconds. Adopting the job deadline there would hand that same
  // supported setup a zero drain and interrupt work that had time to finish.
  it("keeps the full drain when launchd did not initiate the stop", async () => {
    execLaunchctl.mockResolvedValue(printed("running", "\texit timeout = 5\n\tpid = 4242\n"));
    const info = vi.fn();
    const budget = await resolveGatewayShutdownBudget(
      "external",
      { info, warn: vi.fn() },
      stoppingNow,
    );
    budget.log("shutdown");
    expect(info).toHaveBeenCalledWith(
      "shutdown budget at shutdown: drain=315000ms shutdown=325000ms reserve=10000ms exitMargin=5000ms; source=Gateway stop policy=330000ms",
    );
    expect(budget.timeoutMs).toBe(325_000);
    expect(budget.nativeStopBudget).toBe(false);
  });

  it("adopts the job's exit timeout once launchd is stopping it", async () => {
    execLaunchctl.mockResolvedValue(
      printed("SIGTERMed", "\tminimum runtime = 10\n\texit timeout = 5\n\tpid = 4242\n"),
    );
    const info = vi.fn();
    const budget = await resolveGatewayShutdownBudget(
      "external",
      { info, warn: vi.fn() },
      stoppingNow,
    );
    budget.log("shutdown");
    expect(info).toHaveBeenCalledWith(
      "shutdown budget at shutdown: drain=0ms shutdown=0ms reserve=0ms exitMargin=5000ms; source=launchd system/ai.openclaw.gateway exit timeout=5000ms",
    );
    expect(budget.nativeStopBudget).toBe(true);
  });

  it.each([
    { seconds: 20, timeoutMs: 15_000, drainMs: 5_000 },
    { seconds: 47, timeoutMs: 42_000, drainMs: 32_000 },
    { seconds: 90, timeoutMs: 85_000, drainMs: 75_000 },
  ])(
    "derives the budget from a $seconds second exit timeout",
    async ({ seconds, timeoutMs, drainMs }) => {
      execLaunchctl.mockResolvedValue(
        printed("SIGTERMed", `\texit timeout = ${seconds}\n\tpid = 4242\n`),
      );
      const info = vi.fn();
      const budget = await resolveGatewayShutdownBudget(
        "external",
        { info, warn: vi.fn() },
        stoppingNow,
      );
      budget.log("shutdown");
      expect(budget.timeoutMs).toBe(timeoutMs);
      expect(budget.reserveMs).toBe(10_000);
      expect(info).toHaveBeenCalledWith(
        `shutdown budget at shutdown: drain=${drainMs}ms shutdown=${timeoutMs}ms reserve=10000ms exitMargin=5000ms; source=launchd system/ai.openclaw.gateway exit timeout=${seconds * 1_000}ms`,
      );
    },
  );

  // Failing to inspect the job establishes nothing, so shortening the drain here
  // would cut work that no launchd deadline was bounding.
  it("warns and keeps the platform-neutral policy when the job cannot be inspected", async () => {
    execLaunchctl.mockResolvedValue({
      code: 1,
      stdout: "",
      stderr: "permission denied",
      termination: "exit",
    });
    const warn = vi.fn();
    const budget = await resolveGatewayShutdownBudget(
      "external",
      { info: vi.fn(), warn },
      stoppingNow,
    );
    expect(budget.timeoutMs).toBe(325_000);
    // The number alone is not the contract. A failed probe confirmed no launchd
    // deadline, so this must not be classified as a native stop budget either:
    // that flag is what caps a restart drain and arms a forced exit.
    expect(budget.nativeStopBudget).toBe(false);
    expect(warn).toHaveBeenCalledExactlyOnceWith(
      expect.stringContaining("Unable to inspect the launchd job"),
    );
  });

  // The flag is only worth asserting because of what it does downstream, so drive
  // the real consumer. An operator restart that asked to drain for ten minutes
  // keeps that request when no launchd deadline was ever confirmed.
  it("leaves a longer requested restart drain uncapped when the job cannot be inspected", async () => {
    execLaunchctl.mockResolvedValue({
      code: 1,
      stdout: "",
      stderr: "permission denied",
      termination: "exit",
    });
    const budget = await resolveGatewayShutdownBudget(
      "external",
      { info: vi.fn(), warn: vi.fn() },
      stoppingNow,
    );
    expect(budget.nativeStopBudget).toBe(false);
    const drain = resolveGatewayShutdownDrainBudget({
      budget,
      isRestart: true,
      forceRestart: false,
      restartWithoutSupervisor: false,
      acceptedAtMs: performance.now(),
      requestedRestartDrainTimeoutMs: 600_000,
    });
    // Only elapsed time comes off the request; no supervisor ceiling applies.
    expect(drain.drainTimeoutMs).toBeGreaterThan(590_000);
    expect(drain.restartTimeoutMs()).toBe(325_000);
  });

  // The same consumer, with a deadline that WAS confirmed, still gets capped.
  // Without this pair the test above would also pass if the launchd read were
  // deleted outright.
  it("caps that same restart drain at a confirmed job deadline", async () => {
    execLaunchctl.mockResolvedValue(printed("SIGTERMed", "\texit timeout = 47\n\tpid = 4242\n"));
    const budget = await resolveGatewayShutdownBudget(
      "external",
      { info: vi.fn(), warn: vi.fn() },
      stoppingNow,
    );
    expect(budget.nativeStopBudget).toBe(true);
    const drain = resolveGatewayShutdownDrainBudget({
      budget,
      isRestart: true,
      forceRestart: false,
      restartWithoutSupervisor: false,
      acceptedAtMs: performance.now(),
      requestedRestartDrainTimeoutMs: 600_000,
    });
    // 47s job - 5s exit margin = 42000ms shutdown, less the 10000ms reserve.
    expect(drain.drainTimeoutMs).toBe(32_000);
  });

  // A launchd-OWNED Gateway, rather than an externally supervised one. Its startup
  // budget is already native, so this is the configuration where the retained-budget
  // safety net can fire. `previous` is what a 20 second template job resolves.
  const launchdOwnedStop = {
    previous: { timeoutMs: 15_000, nativeStopBudget: true },
    acceptedAtMs: Number.MAX_SAFE_INTEGER,
  };

  // An in-process restart signals the Gateway without launchd running the stop, so
  // the job still prints `running`. That is a confirmed answer, not a failed probe,
  // and claiming the deadline "could not be confirmed" there would be false on every
  // in-process restart of a default macOS install.
  it("does not claim an unconfirmed timeout when launchd is confirmed not to be stopping", async () => {
    delete process.env.OPENCLAW_SUPERVISOR_MODE;
    execLaunchctl.mockResolvedValue(printed("running", "\texit timeout = 20\n\tpid = 4242\n"));
    const warn = vi.fn();
    const budget = await resolveGatewayShutdownBudget(
      "launchd",
      { info: vi.fn(), warn },
      launchdOwnedStop,
    );
    expect(warn).not.toHaveBeenCalled();
    expect(budget.timeoutMs).toBe(15_000);
    expect(budget.nativeStopBudget).toBe(true);
  });

  // A probe that established nothing is the case the safety net exists for, so the
  // startup budget is held rather than widened.
  it("retains the startup budget when the job could not be inspected at all", async () => {
    delete process.env.OPENCLAW_SUPERVISOR_MODE;
    execLaunchctl.mockResolvedValue({
      code: 1,
      stdout: "",
      stderr: "permission denied",
      termination: "exit",
    });
    const warn = vi.fn();
    const budget = await resolveGatewayShutdownBudget(
      "launchd",
      { info: vi.fn(), warn },
      launchdOwnedStop,
    );
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("Unable to inspect the launchd job"));
    expect(warn).toHaveBeenCalledWith(
      "Retaining the startup shutdown budget of 15000ms because the current supervisor stop timeout could not be confirmed.",
    );
    expect(budget.timeoutMs).toBe(15_000);
  });

  // Warned but non-null is the defaulted-value case, not a failed probe: launchd is
  // confirmed to be stopping the job, so a clock is running and there is nothing to
  // retain. Warning about a timeout that "could not be confirmed" here would be the
  // same false statement in a different place.
  it("does not retain when only the deadline's value had to be defaulted", async () => {
    delete process.env.OPENCLAW_SUPERVISOR_MODE;
    execLaunchctl.mockResolvedValue(printed("SIGTERMed", "\tpid = 4242\n"));
    const warn = vi.fn();
    const budget = await resolveGatewayShutdownBudget(
      "launchd",
      { info: vi.fn(), warn },
      launchdOwnedStop,
    );
    expect(warn).toHaveBeenCalledExactlyOnceWith(
      expect.stringContaining("its exit timeout is missing or invalid"),
    );
    expect(budget.timeoutMs).toBe(15_000);
  });

  // No stop is running at startup, so there is no enforcing deadline to read and
  // no reason to spend a launchctl print discovering that.
  it("does not inspect the job at startup", async () => {
    const info = vi.fn();
    const budget = await resolveGatewayShutdownBudget("external", { info, warn: vi.fn() });
    budget.log("startup");
    expect(execLaunchctl).not.toHaveBeenCalled();
    expect(budget.timeoutMs).toBe(325_000);
    expect(budget.nativeStopBudget).toBe(false);
    expect(info).toHaveBeenCalledWith(
      "shutdown budget at startup: drain=315000ms shutdown=325000ms reserve=10000ms exitMargin=5000ms; source=Gateway stop policy=330000ms",
    );
  });

  it("keeps the platform-neutral policy when darwin is not running a launchd job", async () => {
    process.env = {};
    const warn = vi.fn();
    const budget = await resolveGatewayShutdownBudget(null, { info: vi.fn(), warn }, stoppingNow);
    expect(budget.timeoutMs).toBe(325_000);
    expect(budget.nativeStopBudget).toBe(false);
    expect(warn).not.toHaveBeenCalled();
    expect(execLaunchctl).not.toHaveBeenCalled();
  });

  it("never reads systemd on darwin", async () => {
    execLaunchctl.mockResolvedValue(printed("SIGTERMed", "\texit timeout = 20\n\tpid = 4242\n"));
    await resolveGatewayShutdownBudget("external", { info: vi.fn(), warn: vi.fn() }, stoppingNow);
    expect(execSystem).not.toHaveBeenCalled();
    expect(execUser).not.toHaveBeenCalled();
    expect(readFile).not.toHaveBeenCalled();
  });
});
