// Local catalog continuation must match the supervised runtime's enablement gate.
import { describe, expect, it, vi } from "vitest";
import {
  createControl,
  createCodexTestBindingStore,
  createGatewayApi,
  createRuntime,
  fs,
  os,
  path,
  registerCodexSessionCatalog,
  resolveCodexAppServerHomeDir,
  tempDirs,
  withEnvAsync,
  type OpenClawConfig,
} from "./session-catalog.test-helpers.js";

async function registerLocalCatalog(pluginConfig: unknown) {
  const root = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-codex-catalog-supervision-")),
  );
  tempDirs.push(root);
  const agentDir = path.join(root, "agents", "main", "agent");
  const processCodexHome = path.join(root, "process-codex-home");
  await Promise.all(
    [processCodexHome, resolveCodexAppServerHomeDir(agentDir)].map((dir) =>
      fs.mkdir(dir, { recursive: true }),
    ),
  );
  const runtimeConfig = {
    agents: { ownership: "explicit", entries: { main: { agentDir } } },
  } as OpenClawConfig;
  const { runtime, createSessionEntry } = createRuntime();
  const { api, getProvider } = createGatewayApi(runtime, runtimeConfig);
  const listPage = vi.fn(async (source?: { sourceHomeId: string }) => ({
    sessions: [
      {
        threadId: `thread-${source?.sourceHomeId ?? "missing"}`,
        status: "idle",
        source: "cli",
        archived: false as const,
      },
    ],
  }));
  registerCodexSessionCatalog({
    api,
    bindingStore: createCodexTestBindingStore(),
    control: {
      forRequest: vi.fn((_agentId: string, source?: { sourceHomeId: string }) =>
        createControl({ listPage: async () => await listPage(source) }),
      ),
    },
    getPluginConfig: () => pluginConfig,
    getRuntimeConfig: () => runtimeConfig,
  });
  const provider = getProvider()!;
  const list = () =>
    withEnvAsync({ CODEX_HOME: processCodexHome }, async () => {
      const completions: Promise<void>[] = [];
      const hosts = await provider.list({
        agentId: "main",
        listNodes: async () => ({ nodes: [] }),
        waitUntil: (completion) => {
          completions.push(completion);
        },
      });
      await Promise.all(completions);
      return hosts ?? [];
    });
  return { provider, list, createSessionEntry, processCodexHome };
}

describe("Codex catalog supervision gate", () => {
  it.each([
    { state: "absent", pluginConfig: undefined, canContinue: false },
    { state: "enabled", pluginConfig: { supervision: { enabled: true } }, canContinue: true },
  ])(
    "supervision $state sets local canContinue to $canContinue",
    async ({ pluginConfig, canContinue }) => {
      const { list } = await registerLocalCatalog(pluginConfig);
      const sessions = (await list()).flatMap((host) => host.sessions);

      expect(sessions.length).toBeGreaterThan(0);
      for (const session of sessions) {
        expect(session).toMatchObject({ canContinue, canArchive: true });
      }
    },
  );

  it("rejects local continuation before adoption when supervision is disabled", async () => {
    const { provider, list, createSessionEntry, processCodexHome } = await registerLocalCatalog({
      supervision: { enabled: false },
    });
    const [host] = await list();
    const session = host?.sessions[0];
    expect(session).toBeDefined();

    await withEnvAsync({ CODEX_HOME: processCodexHome }, async () => {
      await expect(
        provider.continueSession!({
          agentId: "main",
          hostId: host!.hostId,
          threadId: session!.threadId,
          ...(session!.sourceHomeId ? { sourceHomeId: session!.sourceHomeId } : {}),
          clientScopes: ["operator.admin"],
        }),
      ).rejects.toThrow("Codex supervision is disabled");
    });
    expect(createSessionEntry).not.toHaveBeenCalled();
  });
});
