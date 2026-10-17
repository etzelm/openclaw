import fs from "node:fs"; import crypto from "node:crypto";
const R = "<scratch>/runA";
const sha = (x) => crypto.createHash("sha256").update(JSON.stringify(x)).digest("hex");
const A = (x)=>sha(x.map((h)=>[h.path,h.startLine,h.endLine,h.score]));
const rd=(f)=>fs.readFileSync(f,"utf8"); const res=(f)=>JSON.parse(rd(f)).results;
const recs=(f)=>rd(f).trim().split("\n").filter(Boolean).map(l=>JSON.parse(l));
const qs = ["saffron glacier orchard","lorem ipsum","copper willow","harbor lantern meadow","cobalt ember tundra"];
let m = "# Gateway proof summary (PR #175555, base d4d2c3dd1e3 vs patched d27f9cb3eb7)\n\nAll commands ran on the Mac Studio with a clean env (`env -i`), observer sha256 6311a30bc56fda668412f27c140a5318f57e22f6e6a383a3b1aa6b98a3267645, trace logging, loopback only.\n\n";
m += "## Run structure\n\n- Run 1 (`logs-gw`, `obs-gw`): `cp -a runA/<arm>/state state-gw`, only `logging.file` rewritten (diff in `config.diff`). The copied seal was present (see `seal-before.txt`) but the gateway logged `integrityGateReason: no-proof`, `integrityGateMode: full` for the copy, i.e. the copy was NOT treated as a clean-close reopen (seal is apparently not valid for a copied tree; cause not investigated).\n- Run 2 (`logs-gw2`, `obs-gw2`): same `state-gw`, in place, after the run 1 gateway closed with `clean-close receipt: written`. This is the true clean-close reopen: no integrity gate record.\n- Base uses port 18791, patched port 18792 (both free before start). Workspace path in config still points at the original `runA/<arm>/state/workspace` (same as the CLI runs).\n- No CLI observer file (`cli.jsonl`) exists in any arm: none of the CLI processes (gateway call, owner-routed memory search) executed the observed statement.\n\n";
for (const arm of ["base","patched"]) {
  m += `## ${arm}\n\n`;
  for (const [sfx,label] of [["","run 1 (copy, no-proof)"],["2","run 2 (clean-close reopen)"]]) {
    const L=`${R}/${arm}/logs-gw${sfx}`, O=`${R}/${arm}/obs-gw${sfx}`;
    const out = rd(`${L}/gateway.stdout`); const ready = out.split("\n").find(l=>l.includes("http server listening")).slice(0,140);
    m += `### ${arm} ${label}\n\n- Startup command: \`${rd(`${L}/gateway.cmd`).trim()}\`\n- Readiness line (prefix): \`${ready}...\`\n- Gateway pid ${rd(`${L}/gateway.pid`).trim()}, done file: ${rd(`${L}/gateway.done`).trim()}\n- Seals before start: ${rd(`${L}/seal-before.txt`).trim().split("\n").map(s=>"`"+s.replace(/.*state-gw\//,"state-gw/")+"`").join(", ")}\n`;
    m += `- memory.status: exit ${rd(`${L}/rpc-status.exit`).trim()}, status ready, files 401, chunks 3626 (see \`rpc-status.out\`)\n\n| step | exit | ms | hits | hash A |\n|---|---|---|---|---|\n`;
    for (let i=0;i<5;i++){ const r=res(`${L}/rpc-search${i+1}.out`); m += `| memory.search "${qs[i]}" | ${rd(`${L}/rpc-search${i+1}.exit`).trim()} | ${rd(`${L}/rpc-search${i+1}.ms`).trim()} | ${r.length} | ${A(r)} |\n`; }
    const o=res(`${L}/cli-memory-search.out`);
    m += `| CLI memory search (auto-route, OPENCLAW_GATEWAY_TOKEN set) | ${rd(`${L}/cli-memory-search.exit`).trim()} | ${rd(`${L}/cli-memory-search.ms`).trim()} | ${o.length} | ${A(o)} |\n`;
    if (fs.existsSync(`${L}/cli-memory-search-notoken.exit`)) m += `| CLI memory search (no token) | ${rd(`${L}/cli-memory-search-notoken.exit`).trim()} | ${rd(`${L}/cli-memory-search-notoken.ms`).trim()} | - | - |\n\nNo-token CLI stdout verbatim:\n\n\`\`\`\n${rd(`${L}/cli-memory-search-notoken.out`)}\`\`\`\n\nstderr verbatim:\n\n\`\`\`\n${rd(`${L}/cli-memory-search-notoken.err`)}\`\`\`\n`;
    m += `\nCLI auto-route stderr (token set), verbatim:\n\n\`\`\`\n${rd(`${L}/cli-memory-search.err`)}\`\`\`\n\nThe gateway log shows the routed call as \`memory.search.owner\` (ws res line), so the auto-route used the shipped owner RPC.\n\n`;
    const rs=recs(`${O}/gateway.jsonl`);
    m += `Observer records written by the gateway process (pid ${[...new Set(rs.map(r=>r.pid))]}, threadId ${[...new Set(rs.map(r=>r.threadId))]}, isMainThread ${[...new Set(rs.map(r=>r.isMainThread))]}): ${rs.length}. Records have no timestamp; arrival was tracked by file size after each step: ${sfx===""?(arm==="base"?"1 record present after startup + memory.status (file 2961 B, before any search), then 1 per memory.search / owner call (5 + 1)":"not sampled mid-run for this arm; 7 records in total, same count as base run 1"):"0 records after startup and memory.status; 2 records after the first memory.search, then 1 per further search / owner call (2 + 4 + 1)"}.\n\n| # | derived table | plan (last) | canonical | derived | stmt_ms | inTransaction | first reconcile callers |\n|---|---|---|---|---|---|---|---|\n`;
    rs.forEach((r,i)=>{ const n=r.callers.map(s=>s.split(" ")[0]); const k=n.indexOf("reconcileMemoryChunkFtsRows"); m+=`| ${i+1} | ${/_docsize\)/.test(r.sql)?"fts_docsize":"fts"} | ${r.plan[r.plan.length-1]} | ${r.canonical_count} | ${r.derived_count} | ${r.stmt_ms} | ${r.inTransaction} | ${n.slice(k,k+4).join(" < ")} |\n`; });
    const all=rs.map(r=>r.callers.join("|")).join();
    m += `\nCaller chain contains: \`schema.admit\` = ${all.includes("schema.admit")} (no frame has that literal name; the schema admission frames are \`admitStoreSearch\`, \`ensureMemoryIndexSchema\`, \`reconcile\`), \`withSqliteDatabaseAdmissionExchange\` = ${all.includes("withSqliteDatabaseAdmissionExchange")}, \`openclaw-agent-execution.worker\` = ${all.includes("openclaw-agent-execution.worker")}, \`manager-publication.worker\` = ${all.includes("manager-publication.worker")}.\n\n`;
  }
}
m += "## Parity (hash A = sha256 of JSON [path,startLine,endLine,score] over `results`; RPC `results` array has the same item shape as CLI `--json` `results`, so the same fields are hashed directly; the RPC wrapper adds agentId/provider/searchMode)\n\n"+rd(`${R}/gw-parity.md`)+"\n";
let eq=true; for (let i=0;i<5;i++){ const a=A(res(`${R}/base/logs-gw/rpc-search${i+1}.out`)), b=A(res(`${R}/base/logs-gw2/rpc-search${i+1}.out`)), c=A(res(`${R}/patched/logs-gw2/rpc-search${i+1}.out`)); if(a!==b||a!==c) eq=false; }
m += `\nRun 2 RPC hashes equal run 1 hashes for both arms (all 5 queries): ${eq}\n\n`;
m += "## Stop results\n\nSIGTERM sent to the pid found with lsof and confirmed with `lsof -a -p PID -d cwd` (cwd was the scratch dir). Each gateway exited within 1 s, `done` file `exit=0`, port free afterwards, both `.seal` files present again in `state-gw` (agent DB seal rewritten by `agent database clean-close receipt: written`). Last 30 stdout lines per run are in `<arm>/logs-gw*/stop-tail.txt`.\n";
fs.writeFileSync("<scratch>/runA/gw-summary.md", m);
// appendix: full records
let ap = "\n## Appendix: observer records quoted in full (run 1 and run 2, JSONL)\n\n";
for (const arm of ["base","patched"]) for (const sfx of ["","2"]) ap += `### ${arm} obs-gw${sfx}/gateway.jsonl\n\n\`\`\`\n${rd(`${R}/${arm}/obs-gw${sfx}/gateway.jsonl`)}\`\`\`\n\n`;
fs.appendFileSync("<scratch>/runA/gw-summary.md", ap);
console.log(m.slice(0,3000));
