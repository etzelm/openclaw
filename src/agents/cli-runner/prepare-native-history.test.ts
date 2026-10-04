// Proves preparation seeds saved history into a fresh Claude CLI session only for the native login that owns it.
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runWithCliHistoryWriter } from "../../config/sessions/cli-history-boundary.js";
import { patchSessionEntryCore } from "../../config/sessions/session-accessor.js";
import { prepareSystemAgentRunAdmission } from "../admitted-run-context.js";
import { testing as cliBackendsTesting } from "../cli-backends.test-support.js";
import * as cliCredentials from "../cli-credentials.js";
import {
  buildDefaultTestCliBackend,
  createCliRunnerPrepareFixture,
  createTestMcpLoopbackClientGrant,
  createTestMcpLoopbackServer,
  createTestMcpLoopbackServerConfig,
} from "../cli-runner.test-helpers.js";
import { prepareCliHistoryBoundary } from "./history-boundary.js";
import { setRawCliBackendForPrepareTest } from "./prepare-mcp.test-support.js";
import { prepareCliRunContext } from "./prepare.js";
import {
  resetCliRunnerPrepareTestDeps,
  setCliRunnerPrepareTestDeps,
} from "./prepare.test-support.js";

const getRuntimeConfigMock = vi.hoisted(() => vi.fn(() => ({})));
vi.mock("../../config/config.js", async () => ({
  getRuntimeConfig: getRuntimeConfigMock,
  resolveGatewayPort: (await import("../../config/paths.js")).resolveGatewayPort,
}));
vi.mock("../sandbox.js", () => ({ ensureSandboxWorkspaceForSession: vi.fn(async () => null) }));
vi.mock("../../plugins/hook-runner-global.js", () => ({ getGlobalHookRunner: vi.fn(() => null) }));

describe("native Claude login history on preparation", () => {
  let fixture: ReturnType<typeof createCliRunnerPrepareFixture>;
  const login = (owner: string | undefined) =>
    vi.spyOn(cliCredentials, "resolveNativeCliLoginOwner").mockReturnValue(owner);

  beforeEach(() => {
    setRawCliBackendForPrepareTest({
      ...buildDefaultTestCliBackend(),
      id: "claude-cli",
      pluginId: "anthropic",
      authEpochMode: "profile-only",
      // Claude disables automatic profile selection, so a native login has no profile at all.
      autoSelectAuthProfile: false,
      config: {
        command: "claude",
        args: ["--print"],
        output: "jsonl",
        input: "stdin",
        sessionMode: "existing",
        reseedFromRawTranscriptWhenUncompacted: true,
      },
    });
    setCliRunnerPrepareTestDeps({
      isWorkspaceBootstrapPending: vi.fn(async () => false),
      makeBootstrapWarn: vi.fn(() => () => undefined),
      resolveBootstrapContextForRun: vi.fn(async () => ({ bootstrapFiles: [], contextFiles: [] })),
      getActiveMcpLoopbackRuntime: vi.fn(() => undefined),
      ensureMcpLoopbackServer: vi.fn(createTestMcpLoopbackServer),
      createMcpLoopbackServerConfig: vi.fn(createTestMcpLoopbackServerConfig),
      mintMcpLoopbackClientGrant: vi.fn(createTestMcpLoopbackClientGrant),
      bindMcpLoopbackClientGrantAdmission: vi.fn(() => true),
      revokeMcpLoopbackClientGrant: vi.fn(() => true),
      resolveMcpLoopbackPolicyTools: vi.fn(() => ({ agentId: "main", tools: [] })),
      resolveMcpLoopbackScopedTools: vi.fn(() => ({ agentId: "main", tools: [] })),
      resolveOpenClawReferencePaths: vi.fn(async () => ({ docsPath: null, sourcePath: null })),
      prepareClaudeCliSkillsPlugin: vi.fn(async () => ({
        args: [],
        cleanup: vi.fn(async () => undefined),
      })),
      getCliLiveSessionGeneration: vi.fn(() => undefined),
      loadManifestModelCatalog: vi.fn(() => []),
    });
    fixture = createCliRunnerPrepareFixture((params) =>
      prepareCliRunContext({ skillsSnapshot: { prompt: "", skills: [] }, ...params }),
    );
  });

  afterEach(async () => {
    await fixture.settle();
    cliBackendsTesting.resetDepsForTest();
    resetCliRunnerPrepareTestDeps();
    vi.restoreAllMocks();
    await fixture.cleanup();
  });

  /** Saves one covered turn under `owner`, then prepares the next fresh Claude session. */
  async function prepareAfterTurnBy(owner: string | undefined, next: string | undefined) {
    const { dir, sessionTarget } = fixture.session;
    const runId = "native-history-run";
    await patchSessionEntryCore(sessionTarget, (entry) => ({ ...entry, activeWriterRunId: runId }));
    const admission = prepareSystemAgentRunAdmission({}, runId, "main", "native-history");
    try {
      login(owner);
      const writer = await prepareCliHistoryBoundary(
        {
          admittedRunContext: await admission.admit("embedded"),
          runId,
          agentDir: path.join(dir, "agents", "main", "agent"),
          provider: "claude-cli",
          model: "sonnet",
          prompt: "seed",
          workspaceDir: dir,
          timeoutMs: 1000,
          sessionId: sessionTarget.sessionId,
          sessionKey: sessionTarget.sessionKey,
          sessionFile: sessionTarget.sessionKey,
          sessionTarget,
        },
        {},
      );
      expect(writer).toBeDefined();
      await runWithCliHistoryWriter(writer, async () =>
        fixture.appendTranscript({
          id: "prior",
          parentId: null,
          timestamp: "2020-01-01T00:00:00.000Z",
          message: { role: "user", content: "native canary", timestamp: 1 },
        }),
      );
      login(next);
      return await fixture.prepare({
        provider: "claude-cli",
        model: "sonnet",
        runId,
        preparedRunAdmission: admission,
        sessionKey: sessionTarget.sessionKey,
      });
    } finally {
      admission.close();
    }
  }

  it("seeds saved history for the same native login with no auth profile", async () => {
    const context = await prepareAfterTurnBy("uuid:account-a", "uuid:account-a");
    expect(context.cliHistoryWriter).toBeDefined();
    expect(context.openClawHistoryPrompt).toContain("native canary");
  });

  it("refuses saved history once the native login changed", async () => {
    const context = await prepareAfterTurnBy("uuid:account-a", "uuid:account-b");
    expect(context.cliHistoryWriter).toBeUndefined();
    expect(context.openClawHistoryPrompt).toBeUndefined();
  });

  it("refuses saved history when the native login cannot be proven", async () => {
    const context = await prepareAfterTurnBy("uuid:account-a", undefined);
    expect(context.cliHistoryWriter).toBeUndefined();
    expect(context.openClawHistoryPrompt).toBeUndefined();
  });
});
