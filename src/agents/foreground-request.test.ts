import { expectDefined } from "@openclaw/normalization-core";
import { describe, expect, it } from "vitest";
import { prepareChannelRunAdmission } from "../auto-reply/reply/channel-run-admission.js";
import {
  attachGatewayLocalUserIngress,
  bindGatewayForegroundUserRequest,
  prepareGatewayLocalUserIngress,
} from "../gateway/local-user-ingress.js";
import {
  assertAdmittedRunForegroundRequest,
  createAdmittedRunOperatorAuthority,
  createOperationalRunInstanceRef,
  prepareAgentRunAdmission,
  prepareSystemAgentRunAdmission,
} from "./admitted-run-context.js";
import {
  combineForegroundUserRequests,
  getForegroundUserRequest,
  prepareForegroundUserRequestClaim,
} from "./foreground-request.js";

function acceptedInput(assertCurrent: () => void = () => {}) {
  const client = {};
  attachGatewayLocalUserIngress(
    client,
    prepareGatewayLocalUserIngress({
      authMethod: "token",
      authenticatedUserExpected: true,
      isLocalClient: false,
      profile: { profileId: "source" },
    }),
  );
  const input = {};
  bindGatewayForegroundUserRequest(client, input, assertCurrent);
  return getForegroundUserRequest({ ...input });
}

const restricted = () =>
  createAdmittedRunOperatorAuthority({
    profileId: "source",
    scopes: ["operator.write"],
    assertCurrent() {},
    rolePolicy: {
      sessionAccessCap: "none",
      sandboxRequired: true,
      agents: "*",
      execution: "foreground-only",
    },
  });

describe("accepted foreground input", () => {
  it("leaves ordinary queued admissions unclaimed until a session requires foreground execution", async () => {
    let current = true;
    const request = acceptedInput(() => {
      if (!current) {
        throw new Error("source retired");
      }
    });
    const prepare = (runId: string) =>
      prepareChannelRunAdmission({
        cfg: {},
        runId,
        agentId: "main",
        ingressKind: "channel",
        boundary: "test",
        foregroundRequest: request,
      });
    const first = prepare("staff-first");
    const delayed = prepare("staff-delayed");
    try {
      const firstContext = await first.admit("embedded");
      current = false;
      const delayedContext = await delayed.admit("embedded");
      const delayedClaim = expectDefined(
        prepareForegroundUserRequestClaim(request, delayedContext.operationalRunInstance),
        "delayed foreground claim",
      );
      const firstClaim = expectDefined(
        prepareForegroundUserRequestClaim(request, firstContext.operationalRunInstance),
        "first foreground claim",
      );
      expect(delayedClaim).toThrow("source retired");
      current = true;
      firstClaim();
      expect(delayedClaim).toThrow("another foreground request");
    } finally {
      await first.close();
      await delayed.close();
    }
  });

  it.each(["heartbeat", "cron", "restart", "continuation"])(
    "does not grant execution from a live %s admission or retained operator",
    async (boundary) => {
      const prepared = prepareSystemAgentRunAdmission({}, boundary, "main", boundary);
      const delegated = prepareSystemAgentRunAdmission(
        {},
        `${boundary}-role`,
        "main",
        boundary,
        undefined,
        restricted(),
      );
      try {
        await expect(prepared.admit("embedded")).resolves.toBeDefined();
        await expect(delegated.admit("embedded")).rejects.toThrow(
          "fresh authenticated user request",
        );
      } finally {
        await prepared.close();
        await delegated.close();
      }
    },
  );

  it("retains one collected request across runtime retry but never issues a second incarnation", async () => {
    const sources = [acceptedInput(), acceptedInput()];
    const request = combineForegroundUserRequests(sources);
    const prepare = (runId: string) =>
      prepareChannelRunAdmission({
        cfg: {},
        runId,
        agentId: "main",
        ingressKind: "channel",
        boundary: "test",
        foregroundRequest: request,
        operatorAuthority: restricted(),
      });
    const first = prepare("first");
    const replay = prepare("replay");
    try {
      const context = await first.admit("embedded");
      expect(await first.admit("embedded")).toBe(context);
      await first.close();
      await expect(replay.admit("embedded")).rejects.toThrow("another foreground request");
      expect(combineForegroundUserRequests([sources[0], undefined])).toBeUndefined();
    } finally {
      await first.close();
      await replay.close();
    }
  });

  it("rejects restricted admission when the accepted input retires during onAdmitted", async () => {
    for (const operatorAuthority of [restricted(), undefined]) {
      let current = true;
      const request = acceptedInput(() => {
        if (!current) {
          throw new Error("source retired");
        }
      });
      const prepared = prepareChannelRunAdmission({
        cfg: {},
        runId: operatorAuthority ? "restricted-disconnect" : "staff-disconnect",
        agentId: "main",
        ingressKind: "channel",
        boundary: "test",
        foregroundRequest: request,
        operatorAuthority,
        onAdmitted: () => {
          // The user connection closes while admission is still preparing.
          current = false;
        },
      });
      try {
        if (operatorAuthority) {
          await expect(prepared.admit("embedded")).rejects.toThrow();
        } else {
          // Ordinary staff work keeps its existing lifetime.
          await expect(prepared.admit("embedded")).resolves.toBeDefined();
        }
      } finally {
        await prepared.close();
      }
    }
  });

  it("lets an admitted restricted turn continue after the browser disconnects", async () => {
    let current = true;
    const request = acceptedInput(() => {
      if (!current) {
        throw new Error("source retired");
      }
    });
    const prepare = (runId: string) =>
      prepareChannelRunAdmission({
        cfg: {},
        runId,
        agentId: "main",
        ingressKind: "channel",
        boundary: "test",
        foregroundRequest: request,
        operatorAuthority: restricted(),
      });
    const admitted = prepare("admitted-then-disconnected");
    const other = prepare("another-run");
    try {
      const context = await admitted.admit("embedded");
      // The tab closes after admission; the bounded turn keeps its authority.
      current = false;
      expect(() => assertAdmittedRunForegroundRequest(context)).not.toThrow();
      // The accepted input still cannot start a second run.
      await expect(other.admit("embedded")).rejects.toThrow("another foreground request");
    } finally {
      await admitted.close();
      await other.close();
    }
  });

  it("does not derive foreground permission from copied audit facts or a recovery token", async () => {
    for (const recovery of [undefined, { retryOnly: true, consume: () => ({ accepted: true }) }]) {
      const prepared = prepareAgentRunAdmission({
        cfg: {},
        operationalRunInstance: createOperationalRunInstanceRef("audit-lookalike"),
        operatorAuthority: restricted(),
        recovery,
        foregroundRequest: recovery ? acceptedInput() : { kind: "foreground-user-request" },
        facts: {
          runId: "audit-lookalike",
          agentId: "main",
          ingress: { kind: "gateway-client", boundary: "authenticated", state: "present" },
          invoker: { state: "present", kind: "person", rawPrincipalRef: "source" },
        },
      });
      try {
        await expect(prepared.admit("embedded")).rejects.toThrow(
          "fresh authenticated user request",
        );
      } finally {
        await prepared.close();
      }
    }
  });
});
