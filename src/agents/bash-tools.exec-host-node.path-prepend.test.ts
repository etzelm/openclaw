import fs from "node:fs/promises";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { resolveExecApprovalsFromFile } from "../infra/exec-approvals.js";
import { formatExecCommand } from "../infra/system-run-command.js";
import { buildSystemRunPreparePayload } from "../test-utils/system-run-prepare-payload.js";
import { executeNodeHostCommand } from "./bash-tools.exec-host-node.js";
import * as execHostShared from "./bash-tools.exec-host-shared.js";
import { EXEC_NODE_PATH_PREPEND_WARNING } from "./exec-node-path-prepend.js";

type GatewayCallParams = {
  command?: string;
  params?: Parameters<typeof buildSystemRunPreparePayload>[0];
  id?: string;
};
const callGatewayToolMock = vi.hoisted(() =>
  vi.fn<(method: string, options: unknown, params?: GatewayCallParams) => Promise<unknown>>(),
);

// mock-isolation: keep node RPC effects inside the fixture without a live Gateway connection.
vi.mock("./tools/gateway.js", () => ({ callGatewayTool: callGatewayToolMock }));
vi.mock("./tools/nodes-utils.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./tools/nodes-utils.js")>()),
  listNodes: async () => [
    {
      nodeId: "node-1",
      connected: true,
      platform: process.platform,
      commands: ["system.run", "system.run.prepare"],
    },
  ],
  resolveNodeIdFromList: () => "node-1",
}));

const nodePolicy = { security: "full", ask: "always" } as const;
let runSystemRun: () => Promise<unknown>;

beforeEach(() => {
  runSystemRun = async () => ({
    payload: { success: false, stderr: "env: node: No such file or directory", exitCode: 127 },
  });
  vi.spyOn(execHostShared, "resolveExecHostApprovalContext").mockResolvedValue({
    approvals: resolveExecApprovalsFromFile({
      file: { version: 1, defaults: { ...nodePolicy, askFallback: "deny" }, agents: {} },
      agentId: "main",
    }),
    hostSecurity: "full",
    hostAsk: "always",
    askFallback: "deny",
  });
  vi.spyOn(execHostShared, "resolveExecApprovalWaitOutcome").mockResolvedValue({
    kind: "resolved",
    decision: "allow-once",
    state: { approvedByAsk: true, deniedReason: null },
  } as Awaited<ReturnType<typeof execHostShared.resolveExecApprovalWaitOutcome>>);
  callGatewayToolMock.mockReset().mockImplementation(async (method, _options, params) => {
    if (method === "exec.approvals.node.get") {
      return { file: { version: 1, defaults: nodePolicy, agents: { main: { allowlist: [] } } } };
    }
    if (method === "exec.approval.request") {
      return { status: "accepted", id: params?.id };
    }
    if (method === "node.invoke" && params?.command === "system.run.prepare") {
      if (!params.params) {
        throw new Error("expected system.run.prepare parameters");
      }
      const prepared = buildSystemRunPreparePayload(params.params);
      return { payload: { ...prepared.payload, execPolicy: nodePolicy } };
    }
    if (method === "node.invoke" && params?.command === "system.run") {
      return await runSystemRun();
    }
    throw new Error(`unexpected gateway call: ${method} ${params?.command ?? ""}`);
  });
});

afterEach(() => vi.restoreAllMocks());

async function runDetached(warnings: string[]) {
  const followup = vi
    .spyOn(execHostShared, "sendExecApprovalFollowupResult")
    .mockResolvedValue(undefined);
  const executable = await fs.realpath(process.execPath);

  const result = await executeNodeHostCommand({
    command: formatExecCommand([executable, "--version"]),
    workdir: await fs.realpath(process.cwd()),
    env: {},
    security: "full",
    ask: "always",
    defaultTimeoutSec: 30,
    approvalRunningNoticeMs: 0,
    warnings: [...warnings],
    agentId: "main",
    sessionKey: "agent:main:main",
    approvalFollowupMode: "agent",
  });

  expect(result.details?.status).toBe("approval-pending");
  await vi.waitFor(() => expect(followup).toHaveBeenCalledOnce());
  return String(followup.mock.calls[0]?.[1]);
}

it.each([
  { label: "unset", warnings: [], suffix: "" },
  {
    label: "set",
    warnings: [EXEC_NODE_PATH_PREPEND_WARNING],
    suffix: `\n\n${EXEC_NODE_PATH_PREPEND_WARNING}`,
  },
])(
  "keeps the node pathPrepend warning on detached results ($label)",
  async ({ warnings, suffix }) => {
    const text = await runDetached(warnings);
    expect(text).toMatch(/^Exec finished \(node=node-1 id=[^,]+, code 127\)\n/);
    expect(text.slice(text.indexOf("\n") + 1)).toBe(
      `env: node: No such file or directory${suffix}`,
    );
  },
);

it.each([
  {
    label: "outcome unknown",
    error: new Error("node connection closed"),
    prefix: "Exec outcome unknown (",
    warns: true,
  },
  {
    label: "policy denied",
    error: Object.assign(new Error("denied"), {
      details: { nodeError: { code: "SYSTEM_RUN_DENIED", message: "SYSTEM_RUN_DENIED: denied" } },
    }),
    prefix: "Exec denied (",
    warns: false,
  },
])(
  "keeps the node pathPrepend warning only when a failed invoke may have run ($label)",
  async ({ error, prefix, warns }) => {
    runSystemRun = async () => {
      throw error;
    };

    const text = await runDetached([EXEC_NODE_PATH_PREPEND_WARNING]);

    expect(text.startsWith(`${prefix}node=node-1 id=`)).toBe(true);
    expect(text.endsWith(`\n\n${EXEC_NODE_PATH_PREPEND_WARNING}`)).toBe(warns);
  },
);
