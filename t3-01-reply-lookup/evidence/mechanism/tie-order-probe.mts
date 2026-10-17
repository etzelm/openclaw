// Tie-order probe through the production reply lookup (readConversationDeliveryInDatabase).
// Two eligible `turn` rows for one reply target with equal updated_at, inserted in both orders.
// Usage (cwd = tree): ./node_modules/.bin/tsx <this file> --tree <tree> --arm BEFORE|AFTER --state-root <dir>
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
console.log(`arm=${ARM}`);
for (const order of [["op-b", "op-a"], ["op-a", "op-b"]]) {
  const dir = path.join(STATE_ROOT, `${ARM}-${order.join("-")}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const database = openOpenClawAgentDatabase({ agentId: "main", env: { OPENCLAW_STATE_DIR: dir } });
  const db = database.db;
  db.prepare(
    `INSERT INTO conversations (conversation_id, channel, account_id, kind, peer_id, delivery_target, created_at, updated_at)
     VALUES ('conv-1', 'synthetic', 'acct', 'direct', 'conv-1', 'conv-1', 1, 1)`,
  ).run();
  const ins = db.prepare(
    `INSERT INTO conversation_deliveries (operation_id, operation_kind, conversation_id, source_session_key, message_hash,
       status, prepared_message_id, platform_message_id, rejection_error, created_at, updated_at)
     VALUES (?, 'turn', 'conv-1', 'synthetic-session', 'h', 'replied', NULL, 'plat-1', NULL, 5, 5)`,
  );
  for (const id of order) ins.run(id);
  const rec = readConversationDeliveryInDatabase(database, { conversationRef: "conv-1", replyToId: "plat-1" });
  console.log(`inserted=${order.join(",")} updated_at=5,5 returned=${rec?.operationId ?? JSON.stringify(rec)}`);
  closeOpenClawAgentDatabasesForTest();
  rmSync(dir, { recursive: true, force: true });
}
