import fs from "node:fs"; import crypto from "node:crypto";
const R = "<scratch>/runA"; const out = `${R}/summary`;
const sha = (x) => crypto.createHash("sha256").update(JSON.stringify(x)).digest("hex");
const qs = ["saffron glacier orchard","lorem ipsum","copper willow","harbor lantern meadow","cobalt ember tundra"];
let p = "# Parity of memory search results (base vs patched)\n\nHash A = sha256 of JSON array of [path,startLine,endLine,score] in result order; Hash B = same without score. Source: `results` array of each `d<N>-search.out` (seal path, observer on).\n\n| query | hits base | hits patched | hash A base | hash A patched | A equal | hash B base | hash B patched | B equal |\n|---|---|---|---|---|---|---|---|---|\n";
const extra = [];
for (let i = 0; i < 5; i++) {
  const r = {};
  for (const X of ["base","patched"]) { const j = JSON.parse(fs.readFileSync(`${R}/${X}/logs/d${i+1}-search.out`,"utf8")); r[X] = j.results; }
  const A = (x)=>sha(x.map((h)=>[h.path,h.startLine,h.endLine,h.score])), B=(x)=>sha(x.map((h)=>[h.path,h.startLine,h.endLine]));
  p += `| ${qs[i]} | ${r.base.length} | ${r.patched.length} | ${A(r.base).slice(0,16)} | ${A(r.patched).slice(0,16)} | ${A(r.base)===A(r.patched)} | ${B(r.base).slice(0,16)} | ${B(r.patched).slice(0,16)} | ${B(r.base)===B(r.patched)} |\n`;
  extra.push(`${qs[i]}: full A base=${A(r.base)} patched=${A(r.patched)}; full B base=${B(r.base)} patched=${B(r.patched)}; byte-identical stdout=${fs.readFileSync(`${R}/base/logs/d${i+1}-search.out`,"utf8")===fs.readFileSync(`${R}/patched/logs/d${i+1}-search.out`,"utf8")}`);
}
// also cross-check all other search outputs for the first query
const base1 = fs.readFileSync(`${R}/base/logs/d1-search.out`,"utf8");
const same = [];
for (const X of ["base","patched"]) for (const f of ["e-noseal-search","e2-seal-search-deep",...[1,2,3,4,5].flatMap(i=>[`f-seal-${i}`,`f-noseal-${i}`])]) same.push(`${X}/${f}: ${fs.readFileSync(`${R}/${X}/logs/${f}.out`,"utf8")===base1}`);
p += "\n## Full hashes and byte comparison\n\n" + extra.map(e=>"- "+e).join("\n") + "\n\n## Query 1 stdout byte-identical to base d1 (all other runs, incl. no-seal and timing runs)\n\n" + same.map(e=>"- "+e).join("\n") + "\n";
fs.writeFileSync(`${out}/parity.md`, p);
// timings
const med = (a)=>{const s=[...a].sort((x,y)=>x-y);return s[(s.length-1)/2]};
const rd = (X,f)=>Number(fs.readFileSync(`${R}/${X}/logs/${f}.ms`,"utf8"));
const raw = fs.readFileSync(`${R}/timing-raw.txt`,"utf8").split("\n").filter(l=>l.includes("load averages")).join("\n");
let t = "# Timings (wall ms of the whole CLI process, observer OFF, interleaved base/patched)\n\nHost was busy (load average ~23 throughout); differences below are within noise unless stated.\n\n";
for (const k of ["seal","noseal"]) {
  const b=[1,2,3,4,5].map(i=>rd("base",`f-${k}-${i}`)), q=[1,2,3,4,5].map(i=>rd("patched",`f-${k}-${i}`));
  t += `## ${k==="seal"?"Seal path (receipt reconcile)":"No-seal path (first admission, fresh pristine copy each run)"}\n\n| run | base ms | patched ms |\n|---|---|---|\n` + b.map((x,i)=>`| ${i+1} | ${x} | ${q[i]} |`).join("\n") + `\n| median | ${med(b)} | ${med(q)} |\n\n`;
}
t += "## uptime before/after\n\n```\n" + raw + "\n```\n";
fs.writeFileSync(`${out}/timings.md`, t);
// observer
let o = "# Observer summary\n\nStatement observed: `SELECT (SELECT COUNT(*) FROM memory_index_chunks) AS canonical_count, (SELECT COUNT(*) FROM memory_index_chunks_fts[_docsize]) AS derived_count`. Counts from step b (copy): chunks=3626, fts=3626, docsize=3626.\n\n| arm | step | records | pid | threadId | isMainThread | derived table | plan (last line) | canonical | derived | stmt_ms | reconcile caller chain |\n|---|---|---|---|---|---|---|---|---|---|---|---|\n";
for (const X of ["base","patched"]) for (const f of fs.readdirSync(`${R}/${X}/obs`).sort()) {
  const lines = fs.readFileSync(`${R}/${X}/obs/${f}`,"utf8").trim().split("\n").filter(Boolean).map(l=>JSON.parse(l));
  for (const r of lines) {
    const c = r.callers.map(s=>s.split(" ")[0]);
    const chain = c.includes("reconcileMemoryChunkFtsRows") ? c.slice(c.indexOf("reconcileMemoryChunkFtsRows"), c.indexOf("reconcileMemoryChunkFtsRows")+5).join(" < ") : "(stack limit 10 frames, not visible)";
    o += `| ${X} | ${f.replace(".jsonl","")} | ${lines.length} | ${r.pid} | ${r.threadId} | ${r.isMainThread} | ${/_docsize\)/.test(r.sql)?"memory_index_chunks_fts_docsize":"memory_index_chunks_fts"} | ${r.plan[r.plan.length-1]} | ${r.canonical_count} | ${r.derived_count} | ${r.stmt_ms} | ${chain} |\n`;
  }
}
o += "\nSteps c1 (status --json) and c2 (status --deep) produced no observer file: status takes the read-only open path and runs no reconcile statement.\nSteps a-index (first record on empty DB at store creation, second from the publication worker first-admission path) show counts 0/0 because the store was just created.\n";
fs.writeFileSync(`${out}/observer-summary.md`, o);
