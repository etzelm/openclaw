// (1) Exactness of partial-index matching: order, subsets, single "=", OR forms.
// (2) The one other bound status IN list against a partial index on main (delivery-queue-sqlite-bound.ts:26-37),
//     planned on main's canonical state schema in :memory:, bound vs literal list.
// Usage: node order-and-sibling-probe.mjs <openclaw-state-schema.sql>
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import process from "node:process";

const plan = (db, sql, args = []) => db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...args).map((r) => r.detail).join(" | ");
const t = new DatabaseSync(":memory:");
console.log(`node ${process.version} sqlite_version ${t.prepare("select sqlite_version() v").get().v}`);
t.exec("CREATE TABLE t(x, s); CREATE INDEX p_in ON t(x) WHERE s IN ('queued', 'sent', 'replied');");
console.log("\n(1) index p_in ON t(x) WHERE s IN ('queued', 'sent', 'replied'); query WHERE x = ? AND <predicate>");
for (const [label, pred, args] of [
  ["literal IN, same order", "s IN ('queued', 'sent', 'replied')", [1]],
  ["literal IN, reordered", "s IN ('sent', 'queued', 'replied')", [1]],
  ["literal IN, two-value subset", "s IN ('queued', 'sent')", [1]],
  ["single literal =", "s = 'sent'", [1]],
  ["OR of literal =, same order", "(s = 'queued' OR s = 'sent' OR s = 'replied')", [1]],
  ["OR of literal =, reordered", "(s = 'sent' OR s = 'queued' OR s = 'replied')", [1]],
  ["bound IN, same order", "s IN (?, ?, ?)", [1, "queued", "sent", "replied"]],
  ["OR of bound =", "(s = ? OR s = ? OR s = ?)", [1, "queued", "sent", "replied"]],
]) {
  console.log(`${label.padEnd(30)} ${pred.padEnd(48)} -> ${plan(t, `SELECT * FROM t WHERE x = ? AND ${pred}`, args)}`);
}

const db = new DatabaseSync(":memory:");
db.exec(readFileSync(process.argv[2], "utf8"));
const head = `SELECT queue_name, id, enqueued_at FROM delivery_queue_entries WHERE status IN`;
const tail = `AND recovery_state = ? AND retention_id_prefix IS NOT NULL`;
console.log("\n(2) delivery_queue bounded-retention policies (delivery-queue-sqlite-bound.ts:26-37), main state schema");
for (const [label, sql, args] of [
  ["prefixed, bound IN", `${head} (?, ?) ${tail} AND queue_name = ? AND retention_id_prefix = ?`, ["completed", "failed", "completed_bounded", "q", "p"]],
  ["prefixed, literal IN", `${head} ('completed', 'failed') AND recovery_state = 'completed_bounded' AND retention_id_prefix IS NOT NULL AND queue_name = ? AND retention_id_prefix = ?`, ["q", "p"]],
  ["global, bound IN", `${head} (?, ?) ${tail}`, ["completed", "failed", "completed_bounded"]],
  ["global, literal IN", `${head} ('completed', 'failed') AND recovery_state = 'completed_bounded' AND retention_id_prefix IS NOT NULL`, []],
]) {
  console.log(`${label.padEnd(22)} -> ${plan(db, sql, args)}`);
}
