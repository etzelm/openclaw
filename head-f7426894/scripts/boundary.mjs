import { DatabaseSync } from "node:sqlite";
const db = new DatabaseSync(process.argv[2], { readOnly: true });
for (const r of db.prepare("select * from session_nodes").all()) {
  const raw = r.entry_json; if (!raw) continue;
  const b = JSON.parse(raw).cliHistoryBoundary;
  console.log("cliHistoryBoundary", b ? JSON.stringify({ state: b.state, maxSeq: b.maxSeq }) : "none");
}
