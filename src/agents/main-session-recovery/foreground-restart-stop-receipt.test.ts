import { describe, expect, it, vi } from "vitest";
import type { SessionEntry } from "../../config/sessions/types.js";
import {
  findForegroundRestartStopReceipt,
  foregroundRestartStopNoticeKey,
} from "./foreground-restart-stop-receipt.js";

// A full bounded list: the only state in which a stopped request id can be evicted.
const saturated = Array.from({ length: 64 }, (_, index) => `later-run-${index}`);
const restricted = {
  sessionId: "guest-session",
  updatedAt: 1,
  execution: "foreground-only",
  restartRecoveryTerminalRunIds: saturated,
} as SessionEntry;
const base = { clientRunId: "guest-run-42", sessionKey: "agent:main:guest", storePath: "/x" };

describe("foreground restart stop receipt", () => {
  it("recognizes an evicted stopped request by its exact scoped notice", async () => {
    const find = vi.fn(async () => ({ event: { message: {} } }) as never);
    await expect(
      findForegroundRestartStopReceipt({ ...base, entry: restricted, find }),
    ).resolves.toBe("found");
    expect(find).toHaveBeenCalledWith(
      { sessionKey: base.sessionKey, sessionId: "guest-session", storePath: "/x" },
      { kind: "idempotency", key: "foreground-restart:guest-run-42:stopped", assistant: true },
    );
    expect(foregroundRestartStopNoticeKey("guest-run-42")).toBe(
      "foreground-restart:guest-run-42:stopped",
    );
  });

  it("reports absence only after a successful lookup", async () => {
    await expect(
      findForegroundRestartStopReceipt({ ...base, entry: restricted, find: async () => undefined }),
    ).resolves.toBe("absent");
  });

  it("treats a failed lookup as unavailable, not as proof of absence", async () => {
    await expect(
      findForegroundRestartStopReceipt({
        ...base,
        entry: restricted,
        find: async () => {
          throw new Error("history worker unavailable");
        },
      }),
    ).resolves.toBe("unavailable");
  });

  it("does not scan for a fresh message before the terminal list can have evicted anything", async () => {
    const find = vi.fn();
    await expect(
      findForegroundRestartStopReceipt({
        ...base,
        entry: { ...restricted, restartRecoveryTerminalRunIds: saturated.slice(0, 63) },
        find,
      }),
    ).resolves.toBe("absent");
    expect(find).not.toHaveBeenCalled();
  });

  it("does not scan ordinary sessions", async () => {
    const find = vi.fn();
    await expect(
      findForegroundRestartStopReceipt({
        ...base,
        entry: { sessionId: "staff", updatedAt: 1 } as SessionEntry,
        find,
      }),
    ).resolves.toBe("absent");
    expect(find).not.toHaveBeenCalled();
  });
});
