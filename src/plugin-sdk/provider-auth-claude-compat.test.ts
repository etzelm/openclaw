/** Tests the non-secret native Claude login owner used to authorize saved history. */
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useAutoCleanupTempDirTracker } from "../../test/helpers/temp-dir.js";
import { readClaudeNativeLoginOwner } from "./provider-auth-claude-compat.js";

const tempDirs = useAutoCleanupTempDirTracker(afterEach);

function makeHome(files: {
  account?: Record<string, unknown>;
  credentials?: Record<string, unknown>;
  settings?: Record<string, unknown>;
}): string {
  const home = tempDirs.make("openclaw-claude-owner-");
  fs.mkdirSync(path.join(home, ".claude"), { recursive: true });
  const write = (file: string, value: unknown) =>
    fs.writeFileSync(path.join(home, file), JSON.stringify(value), "utf8");
  if (files.account) {
    write(".claude.json", { oauthAccount: files.account });
  }
  if (files.credentials) {
    write(path.join(".claude", ".credentials.json"), { claudeAiOauth: files.credentials });
  }
  if (files.settings) {
    write(path.join(".claude", "settings.json"), files.settings);
  }
  return home;
}

const credentials = (extra: Record<string, unknown> = {}) => ({
  accessToken: "synthetic-access",
  expiresAt: Date.parse("2030-01-01T00:00:00Z"),
  ...extra,
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("readClaudeNativeLoginOwner", () => {
  it("names the owner from the account record once a credential is present", () => {
    const homeDir = makeHome({
      account: { accountUuid: "uuid-a", emailAddress: "a@example.com" },
      credentials: credentials(),
    });
    expect(readClaudeNativeLoginOwner({ homeDir, platform: "linux" })).toBe("uuid:uuid-a");
  });

  it("falls back to the email when the account has no uuid", () => {
    const homeDir = makeHome({
      account: { emailAddress: "a@example.com" },
      credentials: credentials(),
    });
    expect(readClaudeNativeLoginOwner({ homeDir, platform: "linux" })).toBe("email:a@example.com");
  });

  it("keeps the owner when the plan or token changes", () => {
    const account = { accountUuid: "uuid-a" };
    const basic = makeHome({ account, credentials: credentials() });
    const upgraded = makeHome({
      account,
      credentials: credentials({
        accessToken: "rotated-access",
        refreshToken: "synthetic-refresh",
        subscriptionType: "max",
        rateLimitTier: "default_claude_max_20x",
      }),
    });
    expect(readClaudeNativeLoginOwner({ homeDir: basic, platform: "linux" })).toBe(
      readClaudeNativeLoginOwner({ homeDir: upgraded, platform: "linux" }),
    );
  });

  it("does not trust a leftover account record without a credential", () => {
    const homeDir = makeHome({ account: { accountUuid: "uuid-a" } });
    expect(readClaudeNativeLoginOwner({ homeDir, platform: "linux" })).toBeUndefined();
  });

  it("has no owner without an account record", () => {
    const homeDir = makeHome({ credentials: credentials() });
    expect(readClaudeNativeLoginOwner({ homeDir, platform: "linux" })).toBeUndefined();
  });

  it("fails closed when the credential root differs from the account config root", () => {
    const configDir = tempDirs.make("openclaw-claude-config-");
    const secureDir = tempDirs.make("openclaw-claude-secure-");
    vi.stubEnv("CLAUDE_CONFIG_DIR", configDir);
    vi.stubEnv("CLAUDE_SECURESTORAGE_CONFIG_DIR", secureDir);
    fs.writeFileSync(
      path.join(configDir, ".claude.json"),
      JSON.stringify({ oauthAccount: { accountUuid: "uuid-a" } }),
    );
    fs.writeFileSync(
      path.join(secureDir, ".credentials.json"),
      JSON.stringify({ claudeAiOauth: credentials() }),
    );
    expect(readClaudeNativeLoginOwner({ platform: "linux" })).toBeUndefined();
  });

  describe("supplied environment", () => {
    const loginIn = (dir: string, accountUuid: string) => {
      fs.writeFileSync(
        path.join(dir, ".claude.json"),
        JSON.stringify({ oauthAccount: { accountUuid } }),
      );
      fs.writeFileSync(
        path.join(dir, ".credentials.json"),
        JSON.stringify({ claudeAiOauth: credentials() }),
      );
    };

    it("reads the config dir the child receives, not the process one", () => {
      const processDir = tempDirs.make("openclaw-claude-process-");
      const childDir = tempDirs.make("openclaw-claude-child-");
      loginIn(processDir, "uuid-process");
      loginIn(childDir, "uuid-child");
      vi.stubEnv("CLAUDE_CONFIG_DIR", processDir);
      expect(readClaudeNativeLoginOwner({ platform: "linux" })).toBe("uuid:uuid-process");
      expect(
        readClaudeNativeLoginOwner({ platform: "linux", env: { CLAUDE_CONFIG_DIR: childDir } }),
      ).toBe("uuid:uuid-child");
    });

    it("does not fall back to the process env for variables the child lacks", () => {
      const processDir = tempDirs.make("openclaw-claude-process-");
      loginIn(processDir, "uuid-process");
      vi.stubEnv("CLAUDE_CONFIG_DIR", processDir);
      const emptyHome = tempDirs.make("openclaw-claude-empty-home-");
      expect(readClaudeNativeLoginOwner({ platform: "linux", env: { HOME: emptyHome } })).toBe(
        undefined,
      );
    });

    it("reads the child's API key helper and secure-storage split", () => {
      const configDir = tempDirs.make("openclaw-claude-config-");
      loginIn(configDir, "uuid-a");
      const env = { CLAUDE_CONFIG_DIR: configDir };
      expect(readClaudeNativeLoginOwner({ platform: "linux", env })).toBe("uuid:uuid-a");
      fs.writeFileSync(
        path.join(configDir, "settings.json"),
        JSON.stringify({ apiKeyHelper: "echo synthetic" }),
      );
      expect(readClaudeNativeLoginOwner({ platform: "linux", env })).toBeUndefined();
      fs.rmSync(path.join(configDir, "settings.json"));
      const secureDir = tempDirs.make("openclaw-claude-secure-");
      expect(
        readClaudeNativeLoginOwner({
          platform: "linux",
          env: { ...env, CLAUDE_SECURESTORAGE_CONFIG_DIR: secureDir },
        }),
      ).toBeUndefined();
    });

    it("has no owner when the user settings env block selects another login", () => {
      const configDir = tempDirs.make("openclaw-claude-config-");
      loginIn(configDir, "uuid-a");
      const env = { CLAUDE_CONFIG_DIR: configDir };
      fs.writeFileSync(
        path.join(configDir, "settings.json"),
        JSON.stringify({ env: { UNRELATED: "1" } }),
      );
      expect(readClaudeNativeLoginOwner({ platform: "linux", env })).toBe("uuid:uuid-a");
      for (const key of ["ANTHROPIC_AUTH_TOKEN", "CLAUDE_CODE_USE_BEDROCK", "ANTHROPIC_API_KEY"]) {
        fs.writeFileSync(
          path.join(configDir, "settings.json"),
          JSON.stringify({ env: { [key]: "synthetic" } }),
        );
        expect(readClaudeNativeLoginOwner({ platform: "linux", env })).toBeUndefined();
      }
    });

    it.each([
      "ANTHROPIC_API_KEY",
      "ANTHROPIC_AUTH_TOKEN",
      "CLAUDE_CODE_OAUTH_TOKEN",
      "CLAUDE_CODE_USE_BEDROCK",
      "CLAUDE_CODE_USE_VERTEX",
    ])("has no owner when the child selects %s instead of the stored login", (key) => {
      const configDir = tempDirs.make("openclaw-claude-config-");
      loginIn(configDir, "uuid-a");
      expect(
        readClaudeNativeLoginOwner({
          platform: "linux",
          env: { CLAUDE_CONFIG_DIR: configDir, [key]: "1" },
        }),
      ).toBeUndefined();
    });

    it("has no owner for a relative config root the child would resolve against its own cwd", () => {
      const configDir = tempDirs.make("openclaw-claude-config-");
      loginIn(configDir, "uuid-a");
      const relative = path.relative(process.cwd(), configDir);
      expect(path.isAbsolute(relative)).toBe(false);
      expect(
        readClaudeNativeLoginOwner({ platform: "linux", env: { CLAUDE_CONFIG_DIR: relative } }),
      ).toBeUndefined();
    });

    it("derives the Keychain service and account from the child's environment", () => {
      const configDir = tempDirs.make("openclaw-claude-config-");
      loginIn(configDir, "uuid-a");
      const commands: string[] = [];
      const execSync = vi.fn((command: string) => {
        commands.push(command);
        throw new Error("not found");
      }) as never;
      readClaudeNativeLoginOwner({
        platform: "darwin",
        execSync,
        env: { CLAUDE_CONFIG_DIR: configDir, USER: "child-user" },
      });
      expect(commands.length).toBeGreaterThan(0);
      for (const command of commands) {
        expect(command).toContain('-a "child-user"');
        expect(command).toMatch(/-s "Claude Code-credentials-[0-9a-f]{8}"/u);
      }
    });
  });

  it("has no owner when an API key helper replaces the login", () => {
    const homeDir = makeHome({
      account: { accountUuid: "uuid-a" },
      credentials: credentials(),
      settings: { apiKeyHelper: "echo synthetic" },
    });
    expect(readClaudeNativeLoginOwner({ homeDir, platform: "linux" })).toBeUndefined();
  });

  describe("macOS Keychain", () => {
    const keychainPayload = JSON.stringify({ claudeAiOauth: credentials() });

    it("reads the Keychain login without trusting the file beside it", () => {
      const homeDir = makeHome({ account: { accountUuid: "uuid-a" } });
      const execSync = vi.fn(() => keychainPayload) as never;
      expect(readClaudeNativeLoginOwner({ homeDir, platform: "darwin", execSync })).toBe(
        "uuid:uuid-a",
      );
    });

    it("fails closed when the Keychain item exists but cannot be read", () => {
      const homeDir = makeHome({
        account: { accountUuid: "uuid-a" },
        credentials: credentials(),
      });
      // `-w` reads fail (locked or access denied) while the metadata-only lookup succeeds.
      const execSync = vi.fn((command: string) => {
        if (command.includes(" -w ")) {
          throw new Error("denied");
        }
        return "";
      }) as never;
      expect(readClaudeNativeLoginOwner({ homeDir, platform: "darwin", execSync })).toBeUndefined();
    });

    it("uses the credentials file when no Keychain item exists", () => {
      const homeDir = makeHome({
        account: { accountUuid: "uuid-a" },
        credentials: credentials(),
      });
      const execSync = vi.fn(() => {
        throw new Error("not found");
      }) as never;
      expect(readClaudeNativeLoginOwner({ homeDir, platform: "darwin", execSync })).toBe(
        "uuid:uuid-a",
      );
    });
  });
});
