// Prints session_pending_inputs rows (seq, state, consumed, text) of an agent database, read-only.
import { DatabaseSync } from "node:sqlite";
const db = new DatabaseSync(process.argv[2], { readOnly: true });
const cols = db.prepare("pragma table_info(session_pending_inputs)").all().map((c) => c.name);
if (process.argv[3] === "--cols") { console.log(cols.join(",")); process.exit(0); }
for (const r of db.prepare("select * from session_pending_inputs").all()) {
  let text; try { const j = JSON.parse(r.message_json); text = typeof j === "string" ? j : j.text ?? j.message ?? j.prompt ?? j.content; } catch {}
  console.log(`seq=${r.seq} state=${r.state} consumed=${r.consumed_event_id ?? null} text=${JSON.stringify(text)}`);
}
