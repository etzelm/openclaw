import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
const db = new DatabaseSync(process.argv[2], { readOnly: true });
for (const r of db.prepare("select * from session_nodes").all()) {
  const raw = r.entry_json; if (!raw) continue;
  const b = JSON.parse(raw).cliHistoryBoundary;
  if (!b) { console.log("cliHistoryBoundary none"); continue; }
  // fields other than state/maxSeq are reported only as key names; any owner fingerprint as a short hash label
  const label = (v) => "h:" + createHash("sha256").update(String(v)).digest("hex").slice(0, 8);
  const out = { state: b.state, maxSeq: b.maxSeq, keys: Object.keys(b).sort() };
  for (const k of Object.keys(b)) if (/owner|fingerprint/i.test(k)) out[k + "_label"] = label(b[k]);
  console.log("cliHistoryBoundary", JSON.stringify(out));
}
