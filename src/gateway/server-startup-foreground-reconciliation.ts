/**
 * Prior foreground native work must be reconciled before fresh requests or
 * recovery dispatch can run. Failed receipts remain quarantined by their owner.
 *
 * An update canary starts on a copied state snapshot. Its sandbox receipts still
 * name the serving Gateway's live engine and containers, and the registry lock is
 * derived from the canary's private database path, so the serving owner cannot
 * fence it. The canary must never reconcile, kill, or remove those allocations.
 */
export async function reconcileForegroundSandboxesForStartup(params: {
  updateCanary?: boolean;
  warn: (message: string) => void;
  reconcile?: () => Promise<readonly unknown[]>;
}): Promise<"reconciled" | "skipped-update-canary"> {
  if (params.updateCanary) {
    return "skipped-update-canary";
  }
  const reconcile =
    params.reconcile ??
    (await import("../agents/sandbox/docker-native-custody.js"))
      .reconcileForegroundSandboxesAtStartup;
  for (const failure of await reconcile()) {
    params.warn(`Foreground sandbox startup cleanup remains unconfirmed: ${String(failure)}`);
  }
  return "reconciled";
}
