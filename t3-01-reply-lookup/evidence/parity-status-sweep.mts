// Per-status parity sweep through the production reply lookup (readConversationDeliveryInDatabase).
// Usage (cwd = tree): ./node_modules/.bin/tsx <this file> --tree <tree> --arm BEFORE|AFTER --state-root <dir>
import { createHash } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const argv = process.argv.slice(2);
const arg = (name: string) => {
  const i = argv.indexOf(`--${name}`);
  if (i < 0) throw new Error(`missing --${name}`);
  return argv[i + 1];
};
const TREE = path.resolve(arg("tree"));
const ARM = arg("arm");
const STATE_ROOT = path.resolve(arg("state-root"));
const { readConversationDeliveryInDatabase } = await import(
  pathToFileURL(path.join(TREE, "src/config/sessions/conversation-delivery-store.kernel.ts")).href
);
const { openOpenClawAgentDatabase, closeOpenClawAgentDatabasesForTest } = await import(
  pathToFileURL(path.join(TREE, "src/state/openclaw-agent-db.ts")).href
);
const sha16 = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 16);
// Allowed values from CHECK constraint in src/state/openclaw-agent-schema.sql (conversation_deliveries.status).
const STATUSES = ["created", "queued", "sent", "suppressed", "rejected", "unknown", "replied"];

const dir = path.join(STATE_ROOT, ARM);
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });
process.env.OPENCLAW_STATE_DIR = dir;
const database = openOpenClawAgentDatabase({ agentId: "main", env: { OPENCLAW_STATE_DIR: dir } });
const db = database.db;

console.log(`arm=${ARM} tree=${TREE}`);
const insConv = db.prepare(
  `INSERT INTO conversations (conversation_id, channel, account_id, kind, peer_id, delivery_target, created_at, updated_at)
   VALUES (?, 'synthetic', 'acct', 'direct', ?, ?, 1, 1)`,
);
const insDel = db.prepare(
  `INSERT INTO conversation_deliveries (operation_id, operation_kind, conversation_id, source_session_key, message_hash,
     status, prepared_message_id, platform_message_id, rejection_error, created_at, updated_at)
   VALUES (?, ?, ?, 'synthetic-session', 'h', ?, ?, ?, ?, 1, 1)`,
);
STATUSES.forEach((s) => {
  insConv.run(`conv-${s}`, `conv-${s}`, `conv-${s}`);
  insDel.run(`op-${s}`, "turn", `conv-${s}`, s, `prep-${s}`, `plat-${s}`, s === "rejected" ? "x" : null);
});
insConv.run("conv-send", "conv-send", "conv-send");
insDel.run("op-send", "send", "conv-send", "sent", "prep-send", "plat-send", null);

const show = (label: string, by: string, conversationRef: string, replyToId: string) => {
  const rec = readConversationDeliveryInDatabase(database, { conversationRef, replyToId });
  console.log(`${label} by=${by} found=${rec !== undefined} hash=${sha16(rec === undefined ? "undefined" : JSON.stringify(rec))}`);
};
for (const s of STATUSES) {
  show(`status=${s}`, "platform", `conv-${s}`, `plat-${s}`);
  show(`status=${s}`, "prepared", `conv-${s}`, `prep-${s}`);
}
show("kind=send status=sent", "platform", "conv-send", "plat-send");
show("kind=send status=sent", "prepared", "conv-send", "prep-send");
closeOpenClawAgentDatabasesForTest();
rmSync(dir, { recursive: true, force: true });
