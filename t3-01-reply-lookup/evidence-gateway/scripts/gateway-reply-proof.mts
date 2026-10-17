// Drives one arm's built Gateway (dist/index.js, spawned by the qa-lab Gateway
// child harness) through the shipped qa-channel plugin:
//   1. an ordinary inbound DM registers the conversation and its session;
//   2. conversations.turn sends a question into that conversation and records a
//      `turn` delivery; its waiter times out;
//   3. the Gateway is stopped and started again on the same state, so no
//      process-local waiter remains;
//   4. an inbound reply whose reply-to id was never delivered (ledger miss);
//   5. an inbound reply to the question sent in step 2 (matching delivery).
// The reply-lookup observer (NODE_OPTIONS preload) records what the Gateway's
// threads execute. Run from the arm's repo root:
//   node --import ./scripts/tsx.mjs scripts/gateway-reply-proof.mts <outDir> <observer.mjs>
import { existsSync, readdirSync, statSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { setTimeout as sleep } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { createQaGatewayChild } from "../extensions/qa-lab/src/gateway-child.js";
import { startQaLabServer } from "../extensions/qa-lab/src/lab-server.js";
import { defaultQaRuntimeModelForMode } from "../extensions/qa-lab/src/model-selection.runtime.js";
import { startQaProviderServer } from "../extensions/qa-lab/src/providers/server-runtime.js";
import { createQaTransportAdapter } from "../extensions/qa-lab/src/qa-transport-registry.js";

const [outDirArg, observerArg] = process.argv.slice(2);
if (!outDirArg || !observerArg) {
  throw new Error("usage: gateway-reply-proof.mts <outDir> <observer.mjs>");
}
const outDir = path.resolve(outDirArg);
const observerPath = path.resolve(observerArg);
const repoRoot = process.cwd();
await fs.mkdir(outDir, { recursive: true });
const observerLog = path.join(outDir, "observer.jsonl");
const driverLog = path.join(outDir, "driver.log");
await fs.rm(observerLog, { force: true });
await fs.rm(driverLog, { force: true });

async function log(line: string, data?: unknown) {
  const text = `${new Date().toISOString()} ${line}${data === undefined ? "" : ` ${JSON.stringify(data)}`}\n`;
  process.stdout.write(text);
  await fs.appendFile(driverLog, text);
}

const CONVERSATION = { id: "qa-operator", kind: "direct" as const };
const SENDER = { senderId: "qa-operator", senderName: "QA Operator" };
const NEVER_DELIVERED_ID = "qa-reply-target-never-delivered";
const TURN_ID = "t3-01-proof-turn";
const TURN_QUESTION = "Proof question: which colour is the sky?";

const primaryModel = defaultQaRuntimeModelForMode("mock-openai");
const alternateModel = defaultQaRuntimeModelForMode("mock-openai", { alternate: true });

const owner = createQaGatewayChild();
let lab: Awaited<ReturnType<typeof startQaLabServer>> | undefined;
let mock: Awaited<ReturnType<typeof startQaProviderServer>> | undefined;
let exitCode = 0;
let gatewayRef: Awaited<ReturnType<typeof owner.start>> | undefined;

async function saveGatewayLogs() {
  if (!gatewayRef) {
    return;
  }
  await fs.writeFile(path.join(outDir, "gateway-output.log"), gatewayRef.logs());
  const logDir = path.join(gatewayRef.tempRoot, "workspace", "logs");
  if (existsSync(logDir)) {
    await fs.cp(logDir, path.join(outDir, "gateway-file-logs"), { recursive: true });
  }
}

function messages() {
  return lab!.state.getSnapshot().messages;
}

async function waitFor<T>(label: string, read: () => T | undefined, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = read();
    if (value !== undefined) {
      return value;
    }
    await sleep(250);
  }
  throw new Error(`timed out waiting for ${label}`);
}

async function readObserver() {
  if (!existsSync(observerLog)) {
    return [];
  }
  return (await fs.readFile(observerLog, "utf8"))
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

async function waitForLookup(replyToId: string) {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    const hit = (await readObserver()).find(
      (record) =>
        record.event === "reply-lookup" &&
        Array.isArray(record.params) &&
        record.params.includes(replyToId),
    );
    if (hit) {
      return hit;
    }
    await sleep(250);
  }
  throw new Error(`timed out waiting for the reply lookup of ${replyToId}`);
}

function sendInbound(text: string, replyToId?: string) {
  return lab!.state.addInboundMessage({
    conversation: CONVERSATION,
    ...SENDER,
    text,
    ...(replyToId ? { replyToId } : {}),
  });
}

async function waitForOutboundAfter(count: number, label: string) {
  return await waitFor(label, () =>
    messages()
      .filter((message) => message.direction === "outbound")
      .slice(count)
      .find((message) => message.conversation.id === CONVERSATION.id),
  );
}

function outboundCount() {
  return messages().filter((message) => message.direction === "outbound").length;
}

// Same generator as the store a seeding in measure-reply-lookup.mts.
function syntheticStatus(i: number) {
  const m = i % 100;
  return m < 55 ? "sent" : m < 70 ? "replied" : m < 80 ? "suppressed" : m < 88 ? "unknown" : m < 95 ? "rejected" : m < 98 ? "created" : "queued";
}

function seedLedger(databasePath: string, rows: number, conversations: number) {
  const conv = (i: number) => `conv-${String(i).padStart(3, "0")}`;
  const db = new DatabaseSync(databasePath);
  try {
    db.exec("BEGIN");
    const insertConversation = db.prepare(
      `INSERT INTO conversations (conversation_id, channel, account_id, kind, peer_id, delivery_target, created_at, updated_at)
       VALUES (?, 'synthetic', 'acct', 'direct', ?, ?, 1, 1)`,
    );
    for (let i = 0; i < conversations; i++) {
      insertConversation.run(conv(i), conv(i), conv(i));
    }
    const insertDelivery = db.prepare(
      `INSERT INTO conversation_deliveries (operation_id, operation_kind, conversation_id, source_session_key, message_hash,
         status, prepared_message_id, platform_message_id, rejection_error, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'h', ?, ?, ?, ?, ?, ?)`,
    );
    for (let i = 0; i < rows; i++) {
      const s = syntheticStatus(i);
      insertDelivery.run(`op-${i}`, s === "replied" ? "turn" : "send", conv(i % conversations), `synthetic-session-${i % 1000}`, s,
        `prep-${i}`, s === "sent" || s === "replied" ? `msg-${i}` : null, s === "rejected" ? "x" : null, i, i);
    }
    db.exec("COMMIT");
    return {
      deliveries: (db.prepare("SELECT count(*) AS c FROM conversation_deliveries").get() as { c: number }).c,
      conversations: (db.prepare("SELECT count(*) AS c FROM conversations").get() as { c: number }).c,
      plannerStatisticsRows: db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'sqlite_stat1'").get()
        ? (db.prepare("SELECT count(*) AS c FROM sqlite_stat1").get() as { c: number }).c
        : 0,
    };
  } finally {
    db.close();
  }
}

function findAgentDatabases(stateDir: string): string[] {
  // Agent databases live at <state>/agents/<agentId>/agent/*.sqlite.
  const agentsDir = path.join(stateDir, "agents");
  if (!existsSync(agentsDir)) {
    return [];
  }
  return readdirSync(agentsDir).flatMap((agentId) => {
    const dir = path.join(agentsDir, agentId, "agent");
    return existsSync(dir) && statSync(dir).isDirectory()
      ? readdirSync(dir)
          .filter((entry) => entry.endsWith(".sqlite"))
          .map((entry) => path.join(dir, entry))
      : [];
  });
}

try {
  await log(`arm repo HEAD tree: ${repoRoot}`);
  lab = await startQaLabServer({ repoRoot, embeddedGateway: "disabled" });
  const transportResult = await createQaTransportAdapter({
    channelId: "qa-channel",
    driver: "qa-channel",
    outputDir: outDir,
    state: lab.state,
  });
  mock = await startQaProviderServer("mock-openai", { modelRefs: [primaryModel, alternateModel] });
  const gateway = await owner.start({
    repoRoot,
    providerBaseUrl: mock ? `${mock.baseUrl}/v1` : undefined,
    transport: transportResult.adapter,
    transportBaseUrl: lab.listenUrl,
    providerMode: "mock-openai",
    primaryModel,
    alternateModel,
    controlUiEnabled: false,
    runtimeEnvPatch: {
      NODE_OPTIONS: `--import ${pathToFileURL(observerPath).href}`,
      T3_REPLY_LOOKUP_OBSERVER_LOG: observerLog,
      OPENCLAW_LOG_LEVEL: "debug",
    },
  });
  gatewayRef = gateway;
  await log("gateway started", { pid: gateway.pid, model: primaryModel });

  // 1. Ordinary inbound DM: registers the conversation and binds its session.
  let before = outboundCount();
  const first = sendInbound("Hello, this is the QA operator.");
  await log("inbound 1 (ordinary DM)", { id: first.id, replyToId: first.replyToId ?? null });
  const firstReply = await waitForOutboundAfter(before, "reply to inbound 1");
  await log("outbound reply to inbound 1", { id: firstReply.id, replyToId: firstReply.replyToId ?? null });

  const listed = (await gateway.call("conversations.list", { agentId: "qa" }, { timeoutMs: 30_000 })) as {
    conversations?: Array<{ conversationRef: string; channel: string; target: string; kind: string }>;
  };
  const conversation = listed.conversations?.find((entry) => entry.channel === "qa-channel");
  if (!conversation) {
    throw new Error(`conversations.list returned no qa-channel conversation: ${JSON.stringify(listed)}`);
  }
  await log("conversations.list", {
    conversationRef: conversation.conversationRef,
    kind: conversation.kind,
    target: conversation.target,
  });

  // 2. conversations.turn: records a `turn` delivery and waits briefly for a reply.
  before = outboundCount();
  const turnResult = await gateway.call(
    "conversations.turn",
    {
      agentId: "qa",
      turnId: TURN_ID,
      conversationRef: conversation.conversationRef,
      message: TURN_QUESTION,
      timeoutMs: 2_000,
    },
    { timeoutMs: 60_000 },
  );
  await log("conversations.turn result", turnResult);
  const question = await waitFor("turn question on the bus", () =>
    messages().find((message) => message.direction === "outbound" && message.text.includes(TURN_QUESTION)),
  );
  await log("turn question delivered on the bus", { id: question.id, text: question.text });

  // 3. Restart the Gateway on the same state: the turn's waiter is gone, only the
  //    delivery ledger row remains. With PROOF_SEED_ROWS set, the stopped
  //    Gateway's agent database first gets the store a layout of the timing
  //    measurements: that many delivery rows over 50 other conversations, same
  //    status mix, timestamps 0..n-1 (older than the turn row).
  const seedRows = Number(process.env.PROOF_SEED_ROWS ?? "0");
  await gateway.restartAfterStateMutation(async ({ stateDir }) => {
    if (seedRows > 0) {
      await log("seeding", seedLedger(path.join(stateDir, "agents", "qa", "agent", "openclaw-agent.sqlite"), seedRows, 50));
    }
  });
  await log("gateway restarted on the same state", { pid: gateway.pid });

  // 4. Ledger miss: a reply to a message id the Gateway never delivered.
  before = outboundCount();
  const missInbound = sendInbound("This replies to a message that was never delivered.", NEVER_DELIVERED_ID);
  await log("inbound 2 (reply, ledger miss)", { id: missInbound.id, replyToId: missInbound.replyToId });
  const missLookup = await waitForLookup(NEVER_DELIVERED_ID);
  await log("observer: lookup for inbound 2", {
    threadId: missLookup.threadId,
    isMainThread: missLookup.isMainThread,
    rowCount: missLookup.rowCount,
    plan: missLookup.plan,
  });
  const missReply = await waitForOutboundAfter(before, "ordinary dispatch reply to inbound 2");
  await log("outbound reply to inbound 2 (ordinary dispatch)", { id: missReply.id, replyToId: missReply.replyToId ?? null });

  // 5. Matching delivery: a reply to the question sent by conversations.turn.
  before = outboundCount();
  const hitInbound = sendInbound("Blue.", question.id);
  await log("inbound 3 (reply to the turn question, matching delivery)", {
    id: hitInbound.id,
    replyToId: hitInbound.replyToId,
  });
  const hitLookup = await waitForLookup(question.id);
  await log("observer: lookup for inbound 3", {
    threadId: hitLookup.threadId,
    isMainThread: hitLookup.isMainThread,
    rowCount: hitLookup.rowCount,
    rows: hitLookup.rows,
    plan: hitLookup.plan,
  });
  const hitReply = await waitForOutboundAfter(before, "ordinary dispatch reply to inbound 3");
  await log("outbound reply to inbound 3 (ordinary dispatch)", { id: hitReply.id, replyToId: hitReply.replyToId ?? null });
  await sleep(1_000);

  // Ledger state after the run, read-only.
  for (const databasePath of findAgentDatabases(path.join(gateway.tempRoot, "state"))) {
    const db = new DatabaseSync(databasePath, { readOnly: true });
    try {
      const hasTable = db
        .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'conversation_deliveries'")
        .get();
      if (!hasTable) {
        continue;
      }
      // Rows outside the seeded synthetic conversations, plus totals.
      const rows = db
        .prepare(
          "SELECT operation_id, operation_kind, status, platform_message_id, prepared_message_id, created_at, updated_at FROM conversation_deliveries WHERE conversation_id NOT LIKE 'conv-%' ORDER BY created_at",
        )
        .all();
      const counts = db
        .prepare("SELECT operation_kind, status, count(*) AS c FROM conversation_deliveries GROUP BY 1, 2 ORDER BY 1, 2")
        .all();
      await log(`conversation_deliveries in ${path.relative(gateway.tempRoot, databasePath)}`, { rows, counts });
    } finally {
      db.close();
    }
  }
  await fs.writeFile(path.join(outDir, "bus-messages.json"), `${JSON.stringify(messages(), null, 2)}\n`);
  await saveGatewayLogs();
  await log("done");
} catch (error) {
  exitCode = 1;
  await log(`FAILED: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
  try {
    if (lab) {
      await fs.writeFile(path.join(outDir, "bus-messages.json"), `${JSON.stringify(messages(), null, 2)}\n`);
    }
    await saveGatewayLogs();
  } catch {}
} finally {
  try {
    await owner.stop();
  } catch (error) {
    await log(`gateway stop error: ${String(error)}`);
  }
  await mock?.stop();
  await lab?.stop();
}
process.exit(exitCode);
