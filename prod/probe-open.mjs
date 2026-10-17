import { resolveExport } from "./resolve-dist.mjs";
const [arm, store, agentId] = process.argv.slice(2);
const o = await resolveExport(arm, "openOpenClawAgentDatabaseReadOnly");
console.log("opener", o.file, o.exportName);
try {
  const r = o.fn({ agentId, path: store });
  console.log("found", r.found, r.reason ?? "", r.found ? Object.keys(r.database) : "");
  if (r.found) { console.log("cacheSym", Object.getOwnPropertySymbols(r.database.db).map(String)); r.database.close(); }
} catch (e) { console.log("ERR", e.name, String(e.message).replace(/\/Users\/openclaw/g,"<home>").slice(0,300)); }
