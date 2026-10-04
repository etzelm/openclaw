// Proves execution binds a native Claude login history owner to the environment it spawns with.
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CliExecutionHistoryWriter } from "../../config/sessions/cli-history-boundary.js";
import { buildPreparedCliRunContext } from "../cli-runner.test-helpers.js";
import { executePreparedCliRun as executePreparedCliRunImpl } from "./execute.js";
import {
  createManagedRun,
  createSuccessfulProcessExit,
  supervisorSpawnMock,
  wrapPreparedCliRunWithTestAdmission,
} from "./execute.test-support.js";

const executePreparedCliRun = wrapPreparedCliRunWithTestAdmission(executePreparedCliRunImpl);

afterEach(() => {
  supervisorSpawnMock.mockReset();
});

function writerStub(bindsNativeLogin: boolean) {
  const calls: string[] = [];
  const writer: CliExecutionHistoryWriter = {
    target: { agentId: "main", sessionId: "s1", sessionKey: "agent:main:s1", storePath: "x" },
    runId: "run-test",
    authFingerprint: "f".repeat(64),
    bindsNativeLogin,
    assertCurrent: vi.fn(() => void calls.push("assertCurrent")),
    assertReadable: vi.fn(() => void calls.push("assertReadable")),
    assertStream: vi.fn(),
    bindExecutionEnv: vi.fn(() => void calls.push("bindExecutionEnv")),
  };
  return { writer, calls };
}

function nativeContext(writer: CliExecutionHistoryWriter, history = false, calls?: string[]) {
  const context = buildPreparedCliRunContext({
    model: "fixture-model",
    backend: {
      command: "/bin/sh",
      args: [],
      output: "text",
      systemPromptFileArg: undefined,
      input: "stdin",
      env: { CLAUDE_CONFIG_DIR: "/fixture/backend-selected" },
    },
  });
  context.cliHistoryWriter = writer;
  if (history) {
    context.openClawHistoryPrompt = "saved history";
  }
  supervisorSpawnMock.mockImplementation(async () => {
    calls?.push("spawn");
    return createManagedRun({ ...createSuccessfulProcessExit(), durationMs: 1, stdout: "done" });
  });
  return context;
}

describe("native login history owner at execution", () => {
  it("binds the spawned environment and checks the login before spawning, with no recovery prompt", async () => {
    const { writer, calls } = writerStub(true);
    const context = nativeContext(writer, false, calls);
    await expect(executePreparedCliRun(context)).resolves.toMatchObject({ text: "done" });
    expect(writer.bindExecutionEnv).toHaveBeenCalledTimes(1);
    expect(vi.mocked(writer.bindExecutionEnv).mock.calls[0]?.[0]).toMatchObject({
      CLAUDE_CONFIG_DIR: "/fixture/backend-selected",
    });
    expect(supervisorSpawnMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        env: expect.objectContaining({ CLAUDE_CONFIG_DIR: "/fixture/backend-selected" }),
      }),
    );
    const bound = calls.indexOf("bindExecutionEnv");
    const spawned = calls.indexOf("spawn");
    const lastCheck = calls.lastIndexOf("assertCurrent");
    // Bind to the final environment, then a fresh check, then the spawn.
    expect(bound).toBeGreaterThanOrEqual(0);
    expect(spawned).toBeGreaterThan(bound);
    expect(lastCheck).toBeGreaterThan(bound);
    expect(lastCheck).toBeLessThan(spawned);
    expect(writer.assertReadable).not.toHaveBeenCalled();
  });

  it("spawns nothing when the native login check fails", async () => {
    const { writer } = writerStub(true);
    vi.mocked(writer.assertCurrent).mockImplementation(() => {
      throw new Error("CLI history authority changed before execution");
    });
    const context = nativeContext(writer);
    await expect(executePreparedCliRun(context)).rejects.toThrow("CLI history authority changed");
    expect(supervisorSpawnMock).not.toHaveBeenCalled();
  });

  it("spawns nothing when the executing environment selects another owner", async () => {
    const { writer } = writerStub(true);
    vi.mocked(writer.bindExecutionEnv).mockImplementation(() => {
      throw new Error("CLI history authority changed before execution");
    });
    const context = nativeContext(writer);
    await expect(executePreparedCliRun(context)).rejects.toThrow("CLI history authority changed");
    expect(supervisorSpawnMock).not.toHaveBeenCalled();
  });

  it("uses the readable proof for a fresh recovery turn", async () => {
    const { writer } = writerStub(true);
    const context = nativeContext(writer, true);
    await executePreparedCliRun(context);
    expect(writer.assertReadable).toHaveBeenCalled();
  });

  it("leaves a credential-owned writer on the run's own authority outside recovery", async () => {
    const { writer } = writerStub(false);
    const context = nativeContext(writer);
    await executePreparedCliRun(context);
    expect(writer.assertCurrent).not.toHaveBeenCalled();
    expect(writer.assertReadable).not.toHaveBeenCalled();
  });
});
