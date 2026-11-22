import { describe, expect, it, vi } from "vitest";
import { reconcileForegroundSandboxesForStartup } from "./server-startup-foreground-reconciliation.js";

describe("startup foreground sandbox reconciliation", () => {
  it("never reconciles copied live receipts in an update canary", async () => {
    const reconcile = vi.fn(async () => ["copied receipt for the serving Gateway"]);
    const warn = vi.fn();
    await expect(
      reconcileForegroundSandboxesForStartup({ updateCanary: true, warn, reconcile }),
    ).resolves.toBe("skipped-update-canary");
    expect(reconcile).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it("reconciles and reports unconfirmed cleanup on an ordinary start", async () => {
    const reconcile = vi.fn(async () => ["allocation a"]);
    const warn = vi.fn();
    await expect(reconcileForegroundSandboxesForStartup({ warn, reconcile })).resolves.toBe(
      "reconciled",
    );
    expect(reconcile).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledWith(
      "Foreground sandbox startup cleanup remains unconfirmed: allocation a",
    );
  });
});
