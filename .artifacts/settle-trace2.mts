import { chmodSync, mkdirSync, rmSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import * as commitModule from "../src/agents/subagents/registry/subagent-registry-requester-wake-commit.js";

const { commitRequesterWake, getPendingWakeCommit, retryPendingWakeCommit } = commitModule;

/**
 * The reporting decision the lifecycle owner makes at its failure call site.
 *
 * Revisions without the helper have no such decision and report every attempt,
 * which is the behavior this leg is measured against.
 */
const shouldReport: (context: unknown, entry: unknown, error: unknown) => boolean =
  (commitModule as Record<string, unknown>).shouldReportRequesterSettleWakeFailure as never ??
  (() => true);
const HELPER_PRESENT = typeof (commitModule as Record<string, unknown>)
  .shouldReportRequesterSettleWakeFailure === "function";

const LEG = process.argv[2] ?? "leg";
const RESTORE_AT_S = Number(process.argv[3] ?? 470);
const RUN_UNTIL_S = Number(process.argv[4] ?? 1000);

const DIR = `/tmp/settle-store-${LEG}`;
rmSync(DIR, { recursive: true, force: true });
mkdirSync(DIR, { recursive: true });
const db = new DatabaseSync(`${DIR}/settle.db`);
db.exec(
  "CREATE TABLE settle (run_id TEXT PRIMARY KEY, outcome TEXT NOT NULL, settled_at INTEGER NOT NULL)",
);

const START = Date.now();
const at = () => ((Date.now() - START) / 1000).toFixed(1);
const log = (msg: string, extra?: unknown) =>
  console.log(
    `[${LEG}] [t+${at()}s] ${msg}${extra === undefined ? "" : ` ${JSON.stringify(extra)}`}`,
  );

const entry = {
  runId: "run-trace-a",
  childSessionKey: "agent:main:subagent:run-trace-a",
  requesterSessionKey: "agent:main:main",
  requesterDisplayKey: "main",
  task: "investigate",
  cleanup: "keep",
  createdAt: 1_000,
  execution: { status: "terminal", startedAt: 2_000, endedAt: 3_000 },
  expectsCompletionMessage: true,
  delivery: { status: "pending" },
  requesterSettleWake: { status: "dispatching", attemptCount: 3 },
} as never;

let writeAttempts = 0;
let storeFailures = 0;
let retryInvocations = 0;
let reportsEmitted = 0;
let reportsWithheld = 0;
let settledAtS: string | null = null;
const warnings: string[] = [];
let lastFault: { name: string; message: string } | null = null;

const commit = () => {
  writeAttempts += 1;
  try {
    db.prepare(
      "INSERT OR REPLACE INTO settle (run_id, outcome, settled_at) VALUES (?, ?, ?)",
    ).run("run-trace-a", "delivered", Date.now());
    log(`write ${writeAttempts}: STORE WRITE OK`);
    settledAtS = at();
    lastFault = null;
    return true;
  } catch (error) {
    storeFailures += 1;
    const fault = {
      name: (error as Error).name ?? "Error",
      message: String((error as Error).message).slice(0, 60),
    };
    lastFault = fault;
    log(`write ${writeAttempts}: STORE WRITE FAILED`, {
      code: (error as { code?: string }).code ?? null,
      message: fault.message,
    });
    return false;
  }
};

const context = {
  options: {
    runs: new Map([["run-trace-a", entry]]),
    warn: (message: string, meta?: unknown) => {
      warnings.push(message);
      log(`WARN ${message}`, meta);
    },
  },
  pendingRequesterSettleWakeCommits: new WeakMap(),
  newerGenerationOwnsSession: () => false,
} as never;

/**
 * Mirrors src/agents/subagents/registry/subagent-registry-lifecycle-wake.ts,
 * where the owner asks the helper before emitting its per-attempt failure pair.
 */
const reportFailureLikeTheOwner = () => {
  if (!lastFault) {
    return;
  }
  if (shouldReport(context, entry, lastFault)) {
    reportsEmitted += 1;
    log("WARN requester settle wake failed", { error: lastFault, runId: "run-…ce-a" });
    return;
  }
  reportsWithheld += 1;
};

log(`helper present: ${HELPER_PRESENT}`);
log("storage OUTAGE begins: settlement directory made read-only");
chmodSync(DIR, 0o555);

try {
  commitRequesterWake(context, [entry], undefined, commit, true);
  reportFailureLikeTheOwner();
} catch (error) {
  log("initial commit threw", { message: String((error as Error).message).slice(0, 60) });
}

let restored = false;
const finish = () => {
  const rows = db.prepare("SELECT run_id, outcome FROM settle").all();
  const pending = getPendingWakeCommit(context, entry);
  console.log(`[${LEG}] ==== RESULT ====`);
  console.log(
    `[${LEG}] writeAttempts=${writeAttempts} storeFailures=${storeFailures} retryInvocations=${retryInvocations} warnings=${warnings.length}`,
  );
  console.log(
    `[${LEG}] helperPresent=${HELPER_PRESENT} reportsEmitted=${reportsEmitted} reportsWithheld=${reportsWithheld}`,
  );
  console.log(
    `[${LEG}] storageRestoredAtS=${RESTORE_AT_S} requesterSettledAtS=${settledAtS ?? "NEVER"}`,
  );
  console.log(
    `[${LEG}] pendingStillHeld=${pending ? "yes" : "no"} nextAttemptInMs=${pending ? pending.nextAttemptAt - Date.now() : "n/a"}`,
  );
  console.log(`[${LEG}] settlementRowsInStore=${JSON.stringify(rows)}`);
  chmodSync(DIR, 0o755);
  process.exit(0);
};

const tick = setInterval(() => {
  const elapsed = (Date.now() - START) / 1000;
  if (!restored && elapsed >= RESTORE_AT_S) {
    restored = true;
    chmodSync(DIR, 0o755);
    log("storage RECOVERED: settlement directory writable again");
  }
  const pending = getPendingWakeCommit(context, entry);
  if (pending && Date.now() >= pending.nextAttemptAt) {
    retryInvocations += 1;
    try {
      retryPendingWakeCommit(context, pending);
      reportFailureLikeTheOwner();
    } catch (error) {
      log("retry threw", { message: String((error as Error).message).slice(0, 60) });
    }
  }
  if (elapsed >= RUN_UNTIL_S || (restored && settledAtS !== null)) {
    clearInterval(tick);
    finish();
  }
}, 1_000);
