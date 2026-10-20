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
  // Every local status/source mix, so the canArchive/canContinue invariant covers more than idle.
  const listPage = vi.fn(async (source?: { sourceHomeId: string }) => ({
    sessions: (["idle", "notLoaded", "active"] as const).flatMap((status) =>
      ["cli", "exec"].map((kind) => ({
        threadId: `thread-${source?.sourceHomeId ?? "missing"}-${status}-${kind}`,
        status,
        source: kind,
        archived: false as const,
      })),
    ),
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

      const idleCli = sessions.filter((s) => s.status === "idle" && s.source === "cli");
      expect(idleCli.length).toBeGreaterThan(0);
      for (const session of idleCli) {
        expect(session).toMatchObject({ canContinue, canArchive: true });
      }
    },
  );

  // Control UI infers "supervision off" from a local Codex row with canArchive true and
  // canContinue false (catalogComposerReason in ui/src/pages/chat/chat-pane-session-creation.ts).
  // Keep that combination exclusive to supervision off, or replace the inference with a row reason.
  it("only supervision off yields local rows that can archive but not continue", async () => {
    const shape = async (pluginConfig: unknown) => {
      const hosts = await (await registerLocalCatalog(pluginConfig)).list();
      // The primary home and a suffixed source home are both local and both gated.
      expect(hosts.map((host) => host.hostId)).toContain("gateway:local");
      expect(hosts.some((host) => host.hostId.startsWith("gateway:local:"))).toBe(true);
      return {
        rows: hosts
          .flatMap((host) => host.sessions)
          .map(({ status, source, canArchive, canContinue }) => ({
            status,
            source,
            canArchive,
            canContinue,
          })),
      };
    };
    const on = await shape({ supervision: { enabled: true } });
    const off = await shape({ supervision: { enabled: false } });

    expect(on.rows.filter((row) => row.canArchive && !row.canContinue)).toEqual([]);
    expect(on.rows.filter((row) => row.canArchive && row.canContinue).length).toBeGreaterThan(0);
    const archivable = (rows: typeof on.rows) =>
      rows.map(({ status, source, canArchive }) => ({ status, source, canArchive }));
    expect(archivable(off.rows)).toEqual(archivable(on.rows));
    expect(off.rows.filter((row) => row.canContinue)).toEqual([]);
  });

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
