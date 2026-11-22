import { describe, expect, it, vi } from "vitest";
import type { SessionEntry } from "../../config/sessions/types.js";
import { beginSessionWorkAdmission } from "../../sessions/session-lifecycle-admission.js";
import {
  FOREGROUND_THREAD_BUSY,
  rejectBusyForegroundChatSend,
} from "./chat-send-foreground-busy.js";
import type { NormalizedChatSendRequest } from "./chat-send-request.js";
import type { PreparedChatSendSession } from "./chat-send-session.js";
import { assertChatSendExclusiveAdmission } from "./chat-send-work-admission.js";

const sessionKey = "agent:main:dashboard:guest";
const restricted = { sessionId: "s1", updatedAt: 1, execution: "foreground-only" } as SessionEntry;

const mainTurn = {
  turnKind: "main",
  rawMessage: "please continue",
  suppressCommandInterpretation: false,
} as const;

function run(
  entry: SessionEntry | undefined,
  active: Array<{ sessionKey?: string; sessionId?: string }>,
  request: Pick<
    NormalizedChatSendRequest,
    "turnKind" | "rawMessage" | "suppressCommandInterpretation"
  > = mainTurn,
) {
  const respond = vi.fn();
  const rejected = rejectBusyForegroundChatSend({
    request,
    cfg: {},
    client: null,
    context: {
      chatAbortControllers: new Map(active.map((value, index) => [`run-${index}`, value])) as never,
      chatQueuedTurns: new Map() as never,
    },
    entry,
    sessionKey,
    activeRunScopeKey: sessionKey,
    respond,
  });
  return { rejected, respond };
}

describe("busy foreground chat.send", () => {
  it("refuses a second request before admission while the thread has an active run", () => {
    const { rejected, respond } = run(restricted, [{ sessionKey }]);
    expect(rejected).toBe(true);
    expect(respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({ message: expect.stringContaining("It was not queued.") }),
    );
  });

  it("admits the request when the thread is idle or busy elsewhere", () => {
    expect(run(restricted, []).rejected).toBe(false);
    expect(run(restricted, [{ sessionKey: "agent:main:other", sessionId: "s2" }]).rejected).toBe(
      false,
    );
  });

  it("serializes concurrent sends that both passed the early check, inside the writer barrier", async () => {
    const storePath = "/tmp/foreground-busy-concurrent";
    const session = {
      storePath,
      sessionKey,
      backingSessionId: "s1",
      activeRunScopeKey: sessionKey,
      cfg: {},
      entry: restricted,
    } as unknown as PreparedChatSendSession;
    const request = mainTurn as unknown as NormalizedChatSendRequest;
    // No other admitted turn: the first send proceeds.
    expect(() => assertChatSendExclusiveAdmission(request, session, null)).not.toThrow();
    // A competing send already holds the thread's work admission.
    const first = await beginSessionWorkAdmission({
      scope: storePath,
      identities: [sessionKey, "s1"],
      assertAllowed: () => {},
    });
    try {
      expect(() => assertChatSendExclusiveAdmission(request, session, null)).toThrow(
        FOREGROUND_THREAD_BUSY,
      );
      // Ordinary sessions keep their queue behavior under the same contention.
      expect(() =>
        assertChatSendExclusiveAdmission(
          request,
          { ...session, entry: { sessionId: "s1", updatedAt: 1 } } as PreparedChatSendSession,
          null,
        ),
      ).not.toThrow();
    } finally {
      first.release();
    }
  });

  it("lets side questions and commands reach command handling while busy", () => {
    for (const request of [
      { ...mainTurn, turnKind: "btw" as const, rawMessage: "/btw what changed?" },
      { ...mainTurn, rawMessage: "/status" },
      { ...mainTurn, rawMessage: "/think high" },
    ]) {
      expect(run(restricted, [{ sessionKey }], request).rejected).toBe(false);
    }
    // Text that only looks command-shaped, and a directive that carries a body,
    // become ordinary user turns and are refused.
    for (const rawMessage of [
      "/tmp/out.log is empty, why?",
      "!ls",
      "/think high explain the failing test",
    ]) {
      expect(run(restricted, [{ sessionKey }], { ...mainTurn, rawMessage }).rejected).toBe(true);
    }
    // Text whose command interpretation is suppressed is an ordinary user turn.
    expect(
      run(restricted, [{ sessionKey }], {
        ...mainTurn,
        rawMessage: "/status",
        suppressCommandInterpretation: true,
      }).rejected,
    ).toBe(true);
  });

  it("keeps ordinary sessions on their configured queue behavior", () => {
    const { rejected, respond } = run({ sessionId: "s1", updatedAt: 1 } as SessionEntry, [
      { sessionKey },
    ]);
    expect(rejected).toBe(false);
    expect(respond).not.toHaveBeenCalled();
  });
});
