// usage: node rows-all.mjs <openclaw-agent.sqlite>   Every transcript message row, custom rows included.
import { DatabaseSync } from "node:sqlite";
const db = new DatabaseSync(process.argv[2], { readOnly: true });
for (const r of db.prepare("select seq, event_json from transcript_events order by seq").all()) {
  const m = JSON.parse(r.event_json ?? "{}").message;
  if (!m) continue;
  const text = typeof m.content === "string" ? m.content : JSON.stringify(m.content);
  console.log(`seq=${r.seq} role=${m.role}${m.customType ? ` customType=${m.customType}` : ""} text=${JSON.stringify(text.slice(0, 70))}`);
}
