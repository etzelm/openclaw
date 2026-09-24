import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveGatewayShutdownBudget } from "./run-loop-shutdown-budget.js";

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

describe("Gateway stop deadline independent of restart ownership on darwin", () => {
  beforeEach(() => {
    vi.stubGlobal("process", {
      ...process,
      platform: "darwin",
      pid: 4242,
      getuid: () => 501,
      env: {},
    });
    process.env.XPC_SERVICE_NAME = "ai.openclaw.gateway";
  });

  it("clamps an external launchd job to its own exit timeout", async () => {
    process.env.OPENCLAW_SUPERVISOR_MODE = "external";
    execLaunchctl.mockResolvedValue({
      code: 0,
      stdout: "\tstate = running\n\tminimum runtime = 10\n\texit timeout = 5\n\tpid = 4242\n",
      stderr: "",
      termination: "exit",
    });
    const info = vi.fn();
    const budget = await resolveGatewayShutdownBudget("external", { info, warn: vi.fn() });
    budget.log("startup");
    expect(info).toHaveBeenCalledWith(
      "shutdown budget at startup: drain=0ms shutdown=0ms reserve=0ms exitMargin=5000ms; source=launchd system/ai.openclaw.gateway exit timeout=5000ms",
    );
    expect(budget.nativeStopBudget).toBe(true);
    expect(execLaunchctl).toHaveBeenCalled();
  });

  it.each([
    { seconds: 20, timeoutMs: 15_000, drainMs: 5_000, reserveMs: 10_000 },
    { seconds: 90, timeoutMs: 85_000, drainMs: 75_000, reserveMs: 10_000 },
  ])(
    "derives the budget from a $seconds second exit timeout",
    async ({ seconds, timeoutMs, drainMs, reserveMs }) => {
      process.env.OPENCLAW_SUPERVISOR_MODE = "external";
      execLaunchctl.mockResolvedValue({
        code: 0,
        stdout: `\texit timeout = ${seconds}\n\tpid = 4242\n`,
        stderr: "",
        termination: "exit",
      });
      const info = vi.fn();
      const budget = await resolveGatewayShutdownBudget("external", { info, warn: vi.fn() });
      budget.log("shutdown");
      expect(budget.timeoutMs).toBe(timeoutMs);
      expect(budget.reserveMs).toBe(reserveMs);
      expect(info).toHaveBeenCalledWith(
        `shutdown budget at shutdown: drain=${drainMs}ms shutdown=${timeoutMs}ms reserve=${reserveMs}ms exitMargin=5000ms; source=launchd system/ai.openclaw.gateway exit timeout=${seconds * 1_000}ms`,
      );
    },
  );

  it("warns and uses the launchd default when the job cannot be inspected", async () => {
    process.env.OPENCLAW_SUPERVISOR_MODE = "external";
    execLaunchctl.mockResolvedValue({
      code: 1,
      stdout: "",
      stderr: "permission denied",
      termination: "exit",
    });
    const warn = vi.fn();
    const budget = await resolveGatewayShutdownBudget("external", { info: vi.fn(), warn });
    expect(budget.timeoutMs).toBe(15_000);
    expect(budget.nativeStopBudget).toBe(true);
    expect(warn).toHaveBeenCalledExactlyOnceWith(
      expect.stringContaining("Unable to read the launchd exit timeout"),
    );
  });

  it("keeps the platform-neutral policy when darwin is not running a launchd job", async () => {
    process.env = {};
    const warn = vi.fn();
    const budget = await resolveGatewayShutdownBudget(null, { info: vi.fn(), warn });
    expect(budget.timeoutMs).toBe(325_000);
    expect(budget.nativeStopBudget).toBe(false);
    expect(warn).not.toHaveBeenCalled();
    expect(execLaunchctl).not.toHaveBeenCalled();
  });

  it("never reads systemd on darwin", async () => {
    process.env.OPENCLAW_SUPERVISOR_MODE = "external";
    execLaunchctl.mockResolvedValue({
      code: 0,
      stdout: "\texit timeout = 20\n\tpid = 4242\n",
      stderr: "",
      termination: "exit",
    });
    await resolveGatewayShutdownBudget("external", { info: vi.fn(), warn: vi.fn() });
    expect(execSystem).not.toHaveBeenCalled();
    expect(execUser).not.toHaveBeenCalled();
    expect(readFile).not.toHaveBeenCalled();
  });
});
