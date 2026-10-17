import fs from "node:fs"; import crypto from "node:crypto";
const R = "<scratch>/runA";
const sha = (x) => crypto.createHash("sha256").update(JSON.stringify(x)).digest("hex");
const A = (x)=>sha(x.map((h)=>[h.path,h.startLine,h.endLine,h.score])), B=(x)=>sha(x.map((h)=>[h.path,h.startLine,h.endLine]));
const qs = ["saffron glacier orchard","lorem ipsum","copper willow","harbor lantern meadow","cobalt ember tundra"];
const rd = (f)=>fs.readFileSync(f,"utf8");
const res = (f)=>JSON.parse(rd(f)).results;
const recs = (f)=>fs.existsSync(f)?rd(f).trim().split("\n").filter(Boolean).map(l=>JSON.parse(l)):[];
// Part 1
let p1 = "# Observer re-run summary (final observer version)\n\nObserver sha256: " + "6311a30bc56fda668412f27c140a5318f57e22f6e6a383a3b1aa6b98a3267645" + "\n\nHash A/B: same method as tools/summarize.mjs (sha256 of JSON array of [path,startLine,endLine,score] / without score over the results array).\n\n| arm | query | hits | hash A final | hash A earlier | A equal | hash B final | hash B earlier | B equal | stdout byte-identical to earlier |\n|---|---|---|---|---|---|---|---|---|---|\n";
const P1 = {};
for (const arm of ["base","patched"]) for (let i=0;i<5;i++){
  const f = res(`${R}/${arm}/logs-final/d${i+1}-search.out`), e = res(`${R}/${arm}/logs/d${i+1}-search.out`);
  P1[`${arm}${i}`] = A(f);
  p1 += `| ${arm} | ${qs[i]} | ${f.length} | ${A(f)} | ${A(e)} | ${A(f)===A(e)} | ${B(f)} | ${B(e)} | ${B(f)===B(e)} | ${rd(`${R}/${arm}/logs-final/d${i+1}-search.out`)===rd(`${R}/${arm}/logs/d${i+1}-search.out`)} |\n`;
}
const nsb = rd(`${R}/base/logs-final/d1-search.out`);
p1 += "\nNo-seal run (query 1) hash A / equals seal-path d1 stdout of same arm: " + ["base","patched"].map(a=>`${a}: A=${A(res(`${R}/${a}/logs-final/e-noseal-search.out`))} identical=${rd(`${R}/${a}/logs-final/e-noseal-search.out`)===rd(`${R}/${a}/logs-final/d1-search.out`)}`).join("; ") + "\n";
p1 += "\n## Observer records (final observer)\n\n| arm | step | records | pid | threadId | isMainThread | derived table | plan (last) | canonical | derived | stmt_ms | chain from reconcileMemoryChunkFtsRows | contains schema.admit | contains withSqliteDatabaseAdmissionExchange | contains openclaw-agent-execution.worker |\n|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|\n";
for (const arm of ["base","patched"]) for (const f of fs.readdirSync(`${R}/${arm}/obs-final`).sort()) {
  const rs = recs(`${R}/${arm}/obs-final/${f}`);
  for (const r of rs) { const c=r.callers.join("|"); const names=r.callers.map(s=>s.split(" ")[0]); const k=names.indexOf("reconcileMemoryChunkFtsRows");
    p1 += `| ${arm} | ${f.replace(".jsonl","")} | ${rs.length} | ${r.pid} | ${r.threadId} | ${r.isMainThread} | ${/_docsize\)/.test(r.sql)?"fts_docsize":"fts"} | ${r.plan[r.plan.length-1]} | ${r.canonical_count} | ${r.derived_count} | ${r.stmt_ms} | ${names.slice(k,k+6).join(" < ")} | ${c.includes("schema.admit")} | ${c.includes("withSqliteDatabaseAdmissionExchange")} | ${c.includes("openclaw-agent-execution.worker")} |\n`; }
}
fs.writeFileSync("<scratch>/runA/observer-final-summary.md", p1);
// Part 2 parity
let g = "| query | hits base gw | hits patched gw | hits base CLI(final) | hash A base gw | hash A patched gw | hash A base CLI | gw base==gw patched | gw base==CLI base | gw patched==CLI patched |\n|---|---|---|---|---|---|---|---|---|---|\n";
for (let i=0;i<5;i++){
  const gb=res(`${R}/base/logs-gw/rpc-search${i+1}.out`), gp=res(`${R}/patched/logs-gw/rpc-search${i+1}.out`);
  const cb=res(`${R}/base/logs-final/d${i+1}-search.out`), cp=res(`${R}/patched/logs-final/d${i+1}-search.out`);
  // RPC results have extra field textScore? CLI too. hash uses same four fields.
  g += `| ${qs[i]} | ${gb.length} | ${gp.length} | ${cb.length} | ${A(gb).slice(0,16)} | ${A(gp).slice(0,16)} | ${A(cb).slice(0,16)} | ${A(gb)===A(gp)} | ${A(gb)===A(cb)} | ${A(gp)===A(cp)} |\n`;
}
const extra = []; 
for (const a of ["base","patched"]) { const o = res(`${R}/${a}/logs-gw/cli-memory-search.out`); extra.push(`${a} owner-routed CLI memory search (query 1): hits=${o.length} hashA=${A(o)} equal to CLI direct d1=${A(o)===A(res(`${R}/${a}/logs-final/d1-search.out`))}`); }
fs.writeFileSync("<scratch>/runA/gw-parity.md", g + "\n" + extra.map(x=>"- "+x).join("\n")+"\n");
console.log(p1.split("\n").slice(0,16).join("\n")); console.log(g); console.log(extra.join("\n"));
for (const a of ["base","patched"]) { const rs=recs(`${R}/${a}/obs-gw/gateway.jsonl`); console.log(a,"gw records",rs.length,[...new Set(rs.map(r=>r.pid+"/"+r.threadId+"/"+r.isMainThread))], rs.map(r=>r.stmt_ms).join(","), "cli.jsonl exists:", fs.existsSync(`${R}/${a}/obs-gw/cli.jsonl`)); const c=rs.map(r=>r.callers.join("|")).join(); console.log(" schema.admit:",c.includes("schema.admit"),"Exchange:",c.includes("withSqliteDatabaseAdmissionExchange"),"worker:",c.includes("openclaw-agent-execution.worker")); }
