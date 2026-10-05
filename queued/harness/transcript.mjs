// Prints the transcript rows of the harness session and its history boundary (no secrets stored there).
import { DatabaseSync } from "node:sqlite";
const db = new DatabaseSync(process.argv[2], { readOnly: true });
const tables = db.prepare("select name from sqlite_master where type='table'").all().map((r) => r.name);
const evTable = tables.find((t) => /transcript.*event/i.test(t)) ?? tables.find((t) => /transcript/i.test(t));
const cols = db.prepare(`pragma table_info(${evTable})`).all().map((c) => c.name);
const rows = db.prepare(`select * from ${evTable}`).all();
for (const r of rows) {
  const raw = r.event_json ?? r.json ?? r.payload ?? r.data ?? JSON.stringify(r);
  let e; try { e = JSON.parse(raw); } catch { e = {}; }
  const m = e.message ?? e;
  if (m && (m.role === "user" || m.role === "assistant")) {
    const text = typeof m.content === "string" ? m.content : JSON.stringify(m.content);
    console.log(`seq=${r.seq ?? r.raw_seq ?? "?"} role=${m.role} text=${JSON.stringify(text.slice(0, 70))}`);
  }
}
const st = tables.find((t) => /session_entr/i.test(t));
for (const r of db.prepare(`select * from ${st}`).all()) {
  const raw = r.entry_json ?? r.json ?? JSON.stringify(r);
  try { const b = JSON.parse(raw).cliHistoryBoundary; if (b) console.log("cliHistoryBoundary", JSON.stringify({ state: b.state, maxSeq: b.maxSeq })); } catch {}
}
console.error(`[tables used: ${evTable} (${cols.join(",")}), ${st}]`);
