import { DatabaseSync } from "node:sqlite";
const db = new DatabaseSync(process.argv[2], { readOnly: true });
console.log("tables:", db.prepare("select name from sqlite_master where type='table'").all().map((r) => r.name).join(","));
for (const r of db.prepare("select seq, event_json from transcript_events order by seq").all()) {
  const e = JSON.parse(r.event_json);
  const m = e.message ?? {};
  console.log(r.seq, e.type, m.role ?? "", JSON.stringify({ keys: Object.keys(e), mkeys: Object.keys(m), provider: m.provider, model: m.model, stopReason: m.stopReason, api: m.api, custom: e.customType }).slice(0, 400));
}
