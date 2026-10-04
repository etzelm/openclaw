import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { createDeferred } from "../../../test/helpers/promise.js";
import {
  getCliHistoryWriter,
  runWithCliHistoryWriter,
} from "../../config/sessions/cli-history-boundary.js";
import {
  appendTranscriptEventSync,
  loadSessionEntryReadOnly,
  patchSessionEntryCore,
  upsertSessionEntryCore,
} from "../../config/sessions/session-accessor.js";
import * as sessionAccessor from "../../config/sessions/session-accessor.js";
import { projectPublicSessionEntry } from "../../config/sessions/session-entry-projection.js";
import {
  getOwnedSessionTranscriptWriterFence,
  runWithoutOwnedSessionTranscriptWrites,
} from "../../config/sessions/transcript-write-context.js";
import type { InternalSessionEntry } from "../../config/sessions/types.js";
import { useSessionStoreTempDirs } from "../../test-utils/session-state-cleanup.js";
import { prepareSystemAgentRunAdmission } from "../admitted-run-context.js";
import type { AuthProfileCredential } from "../auth-profiles/types.js";
import * as cliCredentials from "../cli-credentials.js";
import { persistCliSessionBindingResult } from "../cli-session-store.js";
import { claimAgentSessionWriter } from "../embedded-agent-runner/run/session-bootstrap.js";
import { CURRENT_SESSION_VERSION, SessionManager } from "../sessions/session-manager.js";
import { persistCliAssistantTranscript } from "./cli-run-transcript.js";
import { prepareCliHistoryBoundary } from "./history-boundary.js";
import { buildCliSessionHistoryPrompt, loadCliSessionPromptContext } from "./session-history.js";
import type { PreparedCliRunContext } from "./types.js";

const sessionDirs = useSessionStoreTempDirs(afterAll, "cli-history-boundary-");
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

async function fixture(withHeader = true) {
  const dir = sessionDirs.make();
  const target = {
    agentId: "main",
    sessionId: "history",
    sessionKey: "agent:main:history",
    storePath: path.join(dir, "openclaw-agent.sqlite"),
  };
  await upsertSessionEntryCore(target, { sessionId: target.sessionId, updatedAt: 1 });
  if (withHeader) {
    appendTranscriptEventSync(target, {
      type: "session",
      version: CURRENT_SESSION_VERSION,
      id: target.sessionId,
      cwd: dir,
      timestamp: new Date(0).toISOString(),
    });
  }
  const manager = () => SessionManager.open(target, dir);
  let runNumber = 0;
  const withRun = async <T>(
    runId: string,
    action: (params: PreparedCliRunContext["params"]) => Promise<T>,
    overrides: Partial<PreparedCliRunContext["params"]> = {},
  ) => {
    const admission = prepareSystemAgentRunAdmission({}, runId, "main", "history-test");
    try {
      return await action({
        admittedRunContext: await admission.admit("embedded"),
        runId,
        agentId: target.agentId,
        sessionId: target.sessionId,
        sessionKey: target.sessionKey,
        sessionFile: target.sessionKey,
        sessionTarget: target,
        storePath: target.storePath,
        provider: "test-cli",
        model: "test-model",
        prompt: "current ask",
        workspaceDir: dir,
        timeoutMs: 1000,
        ...overrides,
      });
    } finally {
      admission.close();
    }
  };
  const run = async <T>(
    epoch: string | undefined,
    action: (allowed: boolean, params: PreparedCliRunContext["params"]) => Promise<T>,
    overrides: Partial<PreparedCliRunContext["params"]> = {},
    credential?: AuthProfileCredential,
    preparedBackend?: Parameters<typeof prepareCliHistoryBoundary>[2],
  ) => {
    const runId = "boundary-run-" + ++runNumber;
    await patchSessionEntryCore(target, (entry) => ({ ...entry, activeWriterRunId: runId }));
    return await withRun(
      runId,
      async (params) => {
        const writer = await prepareCliHistoryBoundary(
          params,
          credential ?? (epoch ? { type: "token", provider: "test-cli", token: epoch } : undefined),
          preparedBackend,
        );
        return await runWithCliHistoryWriter(writer, () => action(Boolean(writer), params));
      },
      overrides,
    );
  };
  const seed = async () =>
    await run("epoch-a", async (allowed) => {
      expect(allowed).toBe(true);
      manager().appendMessage({ role: "user", content: "A private canary", timestamp: 1 });
    });
  return { target, manager, run, seed, withRun };
}

async function history(allowed: boolean, params: PreparedCliRunContext["params"]) {
  return buildCliSessionHistoryPrompt({
    messages: (
      await loadCliSessionPromptContext({
        ...params,
        allowRawTranscriptReseed: true,
        rawTranscriptReseedReason: allowed ? "missing-transcript" : "auth-unknown",
      })
    ).reseedMessages,
    prompt: "current ask",
    maxHistoryChars: 8192,
  });
}

async function settleNativeBinding(
  params: PreparedCliRunContext["params"],
  assertSettlementCurrent: () => void,
) {
  return await persistCliSessionBindingResult({
    agentId: "main",
    provider: params.provider,
    sessionKey: params.sessionKey,
    storePath: params.storePath,
    expectedSession: params.sessionEntry,
    assertSettlementCurrent,
    result: {
      meta: {
        durationMs: 1,
        agentMeta: {
          sessionId: "native-recovered",
          provider: params.provider,
          model: "test-model",
          cliSessionBinding: {
            sessionId: "native-recovered",
            authProfileId: "test-cli:saved",
          },
        },
      },
    },
  });
}

describe("CLI transcript account boundary", () => {
  it("establishes coverage before the first transcript header and user row exist", async () => {
    const f = await fixture(false);
    await f.seed();
    await f.run("epoch-a", async (allowed, params) => {
      expect(await history(allowed, params)).toContain("A private canary");
    });
  });
  it("retains same-account raw and compacted history without exposing private metadata", async () => {
    const f = await fixture();
    await f.seed();
    await f.run("epoch-a", async (allowed, params) => {
      expect(await history(allowed, params)).toContain("A private canary");
      const manager = f.manager();
      const leaf = manager.getLeafId();
      if (!leaf) {
        throw new Error("Missing seeded transcript leaf");
      }
      manager.appendCompaction("A private summary", leaf, 1000);
    });
    await f.run("epoch-a", async (allowed, params) => {
      expect(await history(allowed, params)).toContain("A private summary");
    });
    const entry: InternalSessionEntry | undefined = loadSessionEntryReadOnly(f.target);
    expect(entry?.cliHistoryBoundary?.state).toBe("known");
    if (!entry) {
      throw new Error("Missing session");
    }
    expect(projectPublicSessionEntry(entry)).not.toHaveProperty("cliHistoryBoundary");
  });

  it("distinguishes OAuth account identity from rotating or identity-less tokens", async () => {
    const f = await fixture();
    const credential = {
      type: "oauth" as const,
      provider: "test-cli",
      access: "synthetic-access",
      refresh: "synthetic-refresh",
      expires: Date.now() + 60_000,
    };
    await f.run(undefined, async (allowed) => expect(allowed).toBe(false), {}, credential);
    await f.run(
      undefined,
      async (allowed) => {
        expect(allowed).toBe(true);
        f.manager().appendMessage({ role: "user", content: "named account", timestamp: 1 });
      },
      {},
      { ...credential, accountId: "account-a" },
    );
    await f.run(
      undefined,
      async (allowed, params) => {
        expect(await history(allowed, params)).toContain("named account");
      },
      {},
      { ...credential, accountId: "account-a", access: "rotated-access" },
    );
    await f.run(
      undefined,
      async (allowed) => expect(allowed).toBe(false),
      {},
      { ...credential, accountId: "account-b" },
    );
  });

  describe("native CLI login owner", () => {
    const native = { provider: "claude-cli" };
    // Synthetic logins on disk, selected the way the child Claude selects them: by its config dir.
    const loginIn = (dir: string, accountUuid: string | undefined) => {
      fs.mkdirSync(dir, { recursive: true });
      if (accountUuid === undefined) {
        fs.rmSync(path.join(dir, ".credentials.json"), { force: true });
        return;
      }
      fs.writeFileSync(
        path.join(dir, ".claude.json"),
        JSON.stringify({ oauthAccount: { accountUuid } }),
      );
      fs.writeFileSync(
        path.join(dir, ".credentials.json"),
        JSON.stringify({
          claudeAiOauth: {
            accessToken: "synthetic",
            expiresAt: Date.parse("2030-01-01T00:00:00Z"),
          },
        }),
      );
    };
    const backendUsing = (configDir: string | undefined, env: Record<string, string> = {}) => ({
      backend: {
        command: "claude",
        env: { ...(configDir ? { CLAUDE_CONFIG_DIR: configDir } : {}), ...env },
      },
    });
    const logins = () => {
      const gateway = sessionDirs.make();
      const backend = sessionDirs.make();
      loginIn(gateway, "uuid:gateway-account");
      // The Gateway process has its own login; only the child environment may decide ownership.
      vi.stubEnv("CLAUDE_CONFIG_DIR", gateway);
      return { gateway, backend };
    };
    const seedNative = async (
      f: Awaited<ReturnType<typeof fixture>>,
      prepared: ReturnType<typeof backendUsing>,
    ) => {
      await f.run(
        undefined,
        async (allowed) => {
          expect(allowed).toBe(true);
          f.manager().appendMessage({ role: "user", content: "native canary", timestamp: 1 });
        },
        native,
        undefined,
        prepared,
      );
    };
    const prepareWith = async (
      f: Awaited<ReturnType<typeof fixture>>,
      prepared: ReturnType<typeof backendUsing> | undefined,
    ) => {
      let seeded: string | undefined;
      let allowed = false;
      await f.run(
        undefined,
        async (ok, params) => {
          allowed = ok;
          seeded = await history(ok, params);
        },
        native,
        undefined,
        prepared,
      );
      return { allowed, seeded };
    };
    /** Prepares a native writer on its own run id so assertions can be driven directly. */
    const withNativeWriter = async (
      f: Awaited<ReturnType<typeof fixture>>,
      runId: string,
      prepared: ReturnType<typeof backendUsing>,
      action: (writer: NonNullable<Awaited<ReturnType<typeof prepareCliHistoryBoundary>>>) => void,
    ) => {
      await patchSessionEntryCore(f.target, (entry) => ({ ...entry, activeWriterRunId: runId }));
      await f.withRun(
        runId,
        async (params) => {
          const writer = await prepareCliHistoryBoundary(params, undefined, prepared);
          if (!writer) {
            throw new Error("Missing admitted history writer");
          }
          await runWithCliHistoryWriter(writer, async () => action(writer));
        },
        native,
      );
    };

    it("reseeds a fresh session for the same native login", async () => {
      const f = await fixture();
      const { backend } = logins();
      loginIn(backend, "uuid:account-a");
      await seedNative(f, backendUsing(backend));
      const next = await prepareWith(f, backendUsing(backend));
      expect(next.allowed).toBe(true);
      expect(next.seeded).toContain("native canary");
    });

    it("refuses history after the native login changes", async () => {
      const f = await fixture();
      const { backend } = logins();
      loginIn(backend, "uuid:account-a");
      await seedNative(f, backendUsing(backend));
      loginIn(backend, "uuid:account-b");
      const next = await prepareWith(f, backendUsing(backend));
      expect(next.allowed).toBe(false);
      expect(next.seeded).toBeUndefined();
    });

    it("keeps history unknown when the native login cannot be proven", async () => {
      const f = await fixture();
      const { backend } = logins();
      loginIn(backend, undefined);
      expect((await prepareWith(f, backendUsing(backend))).allowed).toBe(false);
    });

    it("resolves ownership from the backend-selected config dir, not the Gateway login", async () => {
      const f = await fixture();
      const { backend } = logins();
      loginIn(backend, "uuid:backend-account");
      await seedNative(f, backendUsing(backend));
      // Same backend selection keeps the owner.
      const same = await prepareWith(f, backendUsing(backend));
      expect(same.allowed).toBe(true);
      expect(same.seeded).toContain("native canary");
      // Dropping the override runs the child under the Gateway login: another account.
      const gatewayChild = await prepareWith(f, backendUsing(undefined));
      expect(gatewayChild.allowed).toBe(false);
      expect(gatewayChild.seeded).toBeUndefined();
    });

    it("does not credit Gateway-login history to a backend-selected account", async () => {
      const f = await fixture();
      const { backend } = logins();
      loginIn(backend, "uuid:backend-account");
      await seedNative(f, backendUsing(undefined));
      const next = await prepareWith(f, backendUsing(backend));
      expect(next.allowed).toBe(false);
      expect(next.seeded).toBeUndefined();
    });

    it("has no native owner when the child authenticates another way", async () => {
      const f = await fixture();
      const { backend } = logins();
      loginIn(backend, "uuid:account-a");
      const keyed = backendUsing(backend, { ANTHROPIC_API_KEY: "synthetic-key" });
      await f.run(
        undefined,
        async (allowed) => expect(allowed).toBe(false),
        native,
        undefined,
        keyed,
      );
    });

    it("has no native owner without a prepared backend to derive the child environment from", async () => {
      const f = await fixture();
      logins();
      await f.run(undefined, async (allowed) => expect(allowed).toBe(false), native);
    });

    it("does not let the native login stand in for a forwarded credential", async () => {
      const f = await fixture();
      const { backend } = logins();
      loginIn(backend, "uuid:account-a");
      const lookup = vi.spyOn(cliCredentials, "resolveNativeCliLoginOwner");
      const identityLess = {
        type: "oauth" as const,
        provider: "claude-cli",
        access: "synthetic-access",
        refresh: "synthetic-refresh",
        expires: Date.now() + 60_000,
      };
      await f.run(
        undefined,
        async (allowed) => expect(allowed).toBe(false),
        native,
        identityLess,
        backendUsing(backend),
      );
      expect(lookup).not.toHaveBeenCalled();
    });

    it("does not apply this host's login to a node-placed CLI", async () => {
      const f = await fixture();
      const { backend } = logins();
      loginIn(backend, "uuid:account-a");
      const lookup = vi.spyOn(cliCredentials, "resolveNativeCliLoginOwner");
      await f.run(
        undefined,
        async (allowed) => expect(allowed).toBe(false),
        { ...native, sessionEntry: { execHost: "node", execNode: "node-a" } as never },
        undefined,
        backendUsing(backend),
      );
      expect(lookup).not.toHaveBeenCalled();
    });

    it("rejects the read for a reassigned or revoked login, uncached, at the same instant", async () => {
      const f = await fixture();
      const { backend } = logins();
      loginIn(backend, "uuid:account-a");
      // A frozen clock: any time-windowed reuse would still be inside its window.
      vi.spyOn(Date, "now").mockReturnValue(1_000_000);
      await withNativeWriter(f, "boundary-native-fresh", backendUsing(backend), (writer) => {
        writer.assertReadable();
        loginIn(backend, "uuid:account-b");
        expect(() => writer.assertReadable()).toThrow("CLI history authority changed");
        loginIn(backend, undefined);
        expect(() => writer.assertReadable()).toThrow("CLI history authority changed");
        loginIn(backend, "uuid:account-a");
        writer.assertReadable();
        loginIn(backend, "uuid:account-b");
        loginIn(backend, "uuid:account-a");
        writer.assertReadable();
      });
    });

    it("looks the login up on every authority check", async () => {
      const f = await fixture();
      const { backend } = logins();
      loginIn(backend, "uuid:account-a");
      const lookup = vi.spyOn(cliCredentials, "resolveNativeCliLoginOwner");
      await withNativeWriter(f, "boundary-native-every-call", backendUsing(backend), (writer) => {
        lookup.mockClear();
        writer.assertReadable();
        writer.assertReadable();
        writer.assertCurrent();
        expect(lookup).toHaveBeenCalledTimes(3);
      });
    });

    it("keeps output-event checks off the login lookup", async () => {
      const f = await fixture();
      const { backend } = logins();
      loginIn(backend, "uuid:account-a");
      const lookup = vi.spyOn(cliCredentials, "resolveNativeCliLoginOwner");
      await withNativeWriter(f, "boundary-native-stream", backendUsing(backend), (writer) => {
        lookup.mockClear();
        for (let event = 0; event < 20; event += 1) {
          writer.assertStream(true);
          writer.assertStream(false);
        }
        expect(lookup).not.toHaveBeenCalled();
      });
    });

    it("binds execution to the login the spawned environment selects", async () => {
      const f = await fixture();
      const { gateway, backend } = logins();
      loginIn(backend, "uuid:account-a");
      await withNativeWriter(f, "boundary-native-bind", backendUsing(backend), (writer) => {
        expect(writer.bindsNativeLogin).toBe(true);
        writer.bindExecutionEnv({ CLAUDE_CONFIG_DIR: backend });
        writer.assertCurrent();
        // A login reassigned after the bind is caught by the next boundary check.
        loginIn(backend, "uuid:account-b");
        expect(() => writer.assertCurrent()).toThrow("CLI history authority changed");
        loginIn(backend, "uuid:account-a");
        writer.assertCurrent();
        // Execution drifting to another config dir is refused before anything is spawned.
        expect(() => writer.bindExecutionEnv({ CLAUDE_CONFIG_DIR: gateway })).toThrow(
          "CLI history authority changed",
        );
        expect(() => writer.assertCurrent()).toThrow("CLI history authority changed");
        writer.bindExecutionEnv({ CLAUDE_CONFIG_DIR: backend });
        writer.assertCurrent();
      });
    });

    it("refuses to cover a turn whose login changed after preparation", async () => {
      const f = await fixture();
      const { backend } = logins();
      loginIn(backend, "uuid:account-a");
      await seedNative(f, backendUsing(backend));
      const before = loadSessionEntryReadOnly(f.target)?.cliHistoryBoundary;
      await withNativeWriter(f, "boundary-native-coverage", backendUsing(backend), (writer) => {
        // An empty first turn authorizes coverage, so assertCurrent alone must catch the switch.
        loginIn(backend, "uuid:account-b");
        expect(() =>
          f
            .manager()
            .appendMessage({ role: "user", content: "turn under account b", timestamp: 2 }),
        ).toThrow("CLI history authority changed");
        const boundary = loadSessionEntryReadOnly(f.target)?.cliHistoryBoundary;
        expect(boundary).toMatchObject({
          state: "known",
          maxSeq: (before as { maxSeq: number }).maxSeq,
        });
        loginIn(backend, "uuid:account-a");
        f.manager().appendMessage({ role: "user", content: "turn under account a", timestamp: 3 });
        expect(writer.authFingerprint).toBeDefined();
      });
    });
  });

  it("compares resolved static tokens rather than the unchanged SecretRef", async () => {
    const f = await fixture();
    const tokenRef = { source: "env" as const, provider: "default", id: "TEST_TOKEN" };
    await f.run(
      undefined,
      async (allowed) => {
        expect(allowed).toBe(true);
        f.manager().appendMessage({ role: "user", content: "prior token", timestamp: 1 });
      },
      {},
      { type: "token", provider: "test-cli", token: "resolved-a", tokenRef },
    );
    await f.run(
      undefined,
      async (allowed) => expect(allowed).toBe(false),
      {},
      { type: "token", provider: "test-cli", token: "resolved-b", tokenRef },
    );
  });

  it("revokes retained read and coverage capabilities when their admitted run closes", async () => {
    const f = await fixture();
    const writer = await f.run("epoch-a", async () => getCliHistoryWriter(f.target));
    if (!writer) {
      throw new Error("Missing admitted history writer");
    }
    const before = f.manager().getEntries();
    expect(() => writer.assertReadable()).toThrow();
    expect(() =>
      runWithCliHistoryWriter(writer, () =>
        f.manager().appendMessage({
          role: "user",
          content: "late write",
          timestamp: 1,
        }),
      ),
    ).toThrow();
    expect(f.manager().getEntries()).toEqual(before);
  });

  it("detaches background persistence without lending it the closed CLI history proof", async () => {
    const f = await fixture();
    const release = createDeferred();
    const { background } = await f.run("epoch-a", async () => ({
      background: runWithoutOwnedSessionTranscriptWrites(async () => {
        await release.promise;
        f.manager().appendMessage({ role: "user", content: "detached result", timestamp: 1 });
      }),
    }));
    release.resolve();
    await expect(background).resolves.toBeUndefined();
    expect(JSON.stringify(f.manager().getEntries())).toContain("detached result");
    await f.run("epoch-a", async (allowed) => expect(allowed).toBe(false));
  });

  it("cannot launder mixed history by returning to the original account", async () => {
    const f = await fixture();
    await f.seed();
    await f.run("epoch-b", async (allowed, params) => {
      expect(await history(allowed, params)).toBeUndefined();
      f.manager().appendMessage({ role: "user", content: "B private canary", timestamp: 2 });
    });
    for (const epoch of ["epoch-a", "epoch-b"]) {
      await f.run(epoch, async (allowed, params) => {
        expect(await history(allowed, params)).toBeUndefined();
      });
    }
  });

  it.each(["unrecorded append", "rewrite", "missing provenance", "old version"])(
    "refuses legacy, import, and downgrade gaps: %s",
    async (change) => {
      const f = await fixture();
      await f.seed();
      if (change === "unrecorded append") {
        // Models run by an older binary cannot advance the new coverage proof.
        f.manager().appendMessage({ role: "user", content: "unverified account", timestamp: 2 });
      } else if (change === "rewrite") {
        const manager = f.manager();
        manager.appendResetBoundary("reset", manager.getLeafId() ?? undefined);
      } else if (change === "missing provenance") {
        await patchSessionEntryCore(f.target, (entry) => ({
          ...entry,
          cliHistoryBoundary: undefined,
        }));
      } else {
        // A predecessor wrote serialized metadata outside the current typed writer contract.
        const database = new DatabaseSync(f.target.storePath);
        try {
          expect(
            database
              .prepare(
                "UPDATE session_nodes SET entry_json = json_set(entry_json, '$.cliHistoryBoundary.version', 0) WHERE session_key = ?",
              )
              .run(f.target.sessionKey).changes,
          ).toBe(1);
        } finally {
          database.close();
        }
      }
      await f.run("epoch-a", async (allowed, params) => {
        expect(await history(allowed, params)).toBeUndefined();
      });
    },
  );

  it("never treats an authless runtime or borrowed native session as a new trusted history", async () => {
    const f = await fixture();
    await f.run(undefined, async (allowed) => expect(allowed).toBe(false));
    await f.run("epoch-a", async (allowed) => expect(allowed).toBe(false), {
      cliSessionBinding: { sessionId: "external", forceReuse: true },
    });
  });

  it("only an empty reset can establish a fresh account boundary", async () => {
    const f = await fixture();
    await f.seed();
    await f.run("epoch-b", async (allowed) => expect(allowed).toBe(false));
    f.manager().appendResetBoundary("reset");
    await f.run("epoch-b", async (allowed) => {
      expect(allowed).toBe(true);
      f.manager().appendMessage({ role: "user", content: "B fresh canary", timestamp: 2 });
    });
    await f.run("epoch-b", async (allowed, params) => {
      const prompt = await history(allowed, params);
      expect(prompt).toContain("B fresh canary");
      expect(prompt).not.toContain("A private canary");
    });
  });

  it("admits a finished writer's successor while refusing the live writer", async () => {
    const f = await fixture();
    await f.seed();
    const identity = { type: "token" as const, provider: "test-cli", token: "epoch-a" };
    await f.withRun("orchestrator-prior", async (params) => {
      await claimAgentSessionWriter(params);
      await f.withRun("direct-cli-blocked", async (direct) => {
        direct.sessionEntry = loadSessionEntryReadOnly(f.target);
        const before = structuredClone(direct.sessionEntry);
        await expect(prepareCliHistoryBoundary(direct, identity)).rejects.toThrow(
          "CLI history owner changed before preparation",
        );
        expect(direct.sessionEntry).toEqual(before);
      });
    });
    await f.withRun("direct-cli-recovery", async (params) => {
      params.sessionEntry = loadSessionEntryReadOnly(f.target);
      const expectedSession = params.sessionEntry;
      const writer = await prepareCliHistoryBoundary(params, identity);
      expect(writer).toBeDefined();
      if (!writer) {
        throw new Error("Missing admitted history writer");
      }
      expect(params.sessionEntry).toBe(expectedSession);
      expect(loadSessionEntryReadOnly(f.target)?.activeWriterRunId).toBe(params.runId);
      await runWithCliHistoryWriter(writer, async () => {
        expect(getOwnedSessionTranscriptWriterFence({ sessionTarget: f.target })).toEqual({
          expectedLifecycleRevision: undefined,
          expectedWriterRunId: params.runId,
        });
        expect(
          getOwnedSessionTranscriptWriterFence({
            sessionTarget: { sessionKey: f.target.sessionKey },
          }),
        ).toBeUndefined();
        expect(
          getOwnedSessionTranscriptWriterFence({
            sessionTarget: { ...f.target, storePath: path.join(f.target.storePath, "other") },
          }),
        ).toBeUndefined();
        expect(await history(true, params)).toContain("A private canary");
        const result = await persistCliAssistantTranscript({
          runParams: { ...params, persistAssistantTranscript: true },
          text: "recovered CLI answer",
          modelId: "test-model",
          stopReason: "stop",
        });
        expect(result.terminalAnchor).toBeDefined();
      });
      const settled = await settleNativeBinding(params, writer.assertCurrent);
      expect(settled.meta.error).toBeUndefined();
      expect(loadSessionEntryReadOnly(f.target)?.cliSessionBindings?.["test-cli"]).toEqual({
        sessionId: "native-recovered",
        authProfileId: "test-cli:saved",
      });
    });
    expect(JSON.stringify(f.manager().getEntries())).toContain("recovered CLI answer");
  });

  it("rechecks a revived foreign writer after metadata planning yields", async () => {
    const f = await fixture();
    await f.seed();
    await f.withRun("orchestrator-prior", async (params) => {
      await claimAgentSessionWriter(params);
    });
    const before = loadSessionEntryReadOnly(f.target);
    const replacement = prepareSystemAgentRunAdmission(
      {},
      "orchestrator-prior",
      "main",
      "history-test",
    );
    const patch = patchSessionEntryCore;
    vi.spyOn(sessionAccessor, "patchSessionEntryCore").mockImplementation(
      (target, update, options) =>
        patch(
          target,
          async (...args) => {
            const prepared = await update(...args);
            await replacement.admit("embedded");
            return prepared;
          },
          options,
        ),
    );
    try {
      await f.withRun("direct-cli-recovery", async (params) => {
        await expect(
          prepareCliHistoryBoundary(params, {
            type: "token",
            provider: "test-cli",
            token: "epoch-a",
          }),
        ).rejects.toThrow("CLI history owner changed before preparation");
      });
      expect(loadSessionEntryReadOnly(f.target)).toEqual(before);
    } finally {
      replacement.close();
    }
  });

  it.each(["orchestrator-prior", "orchestrator-replacement", "direct-cli-recovery"])(
    "fences recovered history and CLI persistence after %s takes over",
    async (replacementRunId) => {
      const f = await fixture();
      await f.seed();
      await f.withRun("orchestrator-prior", async (params) => {
        await claimAgentSessionWriter(params);
      });
      await f.withRun("direct-cli-recovery", async (params) => {
        params.sessionEntry = loadSessionEntryReadOnly(f.target);
        const writer = await prepareCliHistoryBoundary(params, {
          type: "token",
          provider: "test-cli",
          token: "epoch-a",
        });
        expect(writer).toBeDefined();
        if (!writer) {
          throw new Error("Missing admitted history writer");
        }
        writer.assertReadable();
        await f.withRun(replacementRunId, async (replacement) => {
          await claimAgentSessionWriter(replacement);
          expect
            .soft(() => writer?.assertReadable())
            .toThrow(
              replacementRunId === params.runId
                ? "admitted run authority is no longer active"
                : "CLI history authority changed",
            );
          const before = f.manager().getEntries();
          await runWithCliHistoryWriter(writer, async () => {
            const result = await persistCliAssistantTranscript({
              runParams: { ...params, persistAssistantTranscript: true },
              text: "late recovered CLI answer",
              modelId: "test-model",
              stopReason: "stop",
            });
            expect.soft(result.terminalAnchor).toBeUndefined();
          });
          expect(f.manager().getEntries()).toEqual(before);
          const beforeBindingSettlement = loadSessionEntryReadOnly(f.target);
          await settleNativeBinding(params, writer.assertCurrent);
          expect(loadSessionEntryReadOnly(f.target)).toEqual(beforeBindingSettlement);
        });
      });
    },
  );
});
