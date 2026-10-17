import fs from "node:fs"; import crypto from "node:crypto";
const P = "<scratch>";
const rd = (f) => fs.readFileSync(f, "utf8"); const jl = (f) => rd(f).trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
const H = (r) => crypto.createHash("sha256").update(JSON.stringify(r.map((h) => [h.path, h.startLine, h.endLine, h.score]))).digest("hex");
const Q = ["saffron glacier orchard", "lorem ipsum", "copper willow", "harbor lantern meadow", "cobalt ember tundra"];
const arms = ["before", "after"]; const gruns = ["c1", "t1", "t2"];
// parity
let par = "# Parity\n\nHash = sha256 of JSON [[path,startLine,endLine,score],...] over `results` in result order (25 max, 25 returned for each query).\n\n| query | CLI before | CLI after | GW before c1 | GW before t1 | GW before t2 | GW after c1 | GW after t1 | GW after t2 | all equal |\n|---|---|---|---|---|---|---|---|---|---|\n";
let allOk = true;
for (let i = 0; i < 5; i++) {
  const hs = [];
  for (const a of arms) hs.push(H(JSON.parse(rd(`${P}/synthetic/${a}/logs/cli-search${i + 1}.out`)).results));
  for (const a of arms) for (const g of gruns) hs.push(H(JSON.parse(rd(`${P}/gateway/${a}/${g}/calls/s${String(i + 1).padStart(2, "0")}.out`)).results));
  const eq = new Set(hs).size === 1; if (!eq) allOk = false;
  par += `| ${Q[i]} | ${hs.map((h) => h.slice(0, 16)).join(" | ")} | ${eq} |\n`;
}
// all 30 searches per run consistent with the cycle
let cyc = true;
for (const a of arms) for (const g of gruns) for (let n = 1; n <= 30; n++) {
  const h = H(JSON.parse(rd(`${P}/gateway/${a}/${g}/calls/s${String(n).padStart(2, "0")}.out`)).results);
  const h0 = H(JSON.parse(rd(`${P}/gateway/${a}/${g}/calls/s0${((n - 1) % 5) + 1}.out`)).results);
  if (h !== h0) cyc = false;
}
par += `\nAll CLI and gateway hashes equal across arms and runs: ${allOk}. Every one of the 30 calls in each of the 6 gateway runs equals the hash of its query's first call: ${cyc}.\nFirst 16 hex chars shown; full hashes are recomputable with tools/report.mjs from the saved .out files.\n`;
// also raw exits
let exits = [];
for (const a of arms) for (const g of gruns) { const c = jl(`${P}/gateway/${a}/${g}/calls.jsonl`); exits.push(`${a}/${g}: ${c.filter((x) => x.status === 0).length}/${c.length} calls exit 0`); }
par += `\nCall exit codes: ${exits.join("; ")}.\n`;
fs.writeFileSync(`${P}/parity.md`, par);
// plans
const planOf = (f) => { const m = {}; for (const r of jl(f).filter((r) => r.ev === "eqp")) (m[r.shape] ??= []).push({ hash: r.sqlHash, plan: r.plan }); return m; };
const srcs = { "gateway c1": (a) => `${P}/gateway/${a}/c1/gateway.obs.jsonl`, "cli search1": (a) => `${P}/synthetic/${a}/logs/cli-search1.obs.jsonl`, "cli search3": (a) => `${P}/synthetic/${a}/logs/cli-search3.obs.jsonl` };
let pl = "# Query plans (EXPLAIN QUERY PLAN, captured at the first run of each distinct SQL text with the real bound values; values not stored)\n\nShapes: chunk_keyword (FTS rank query on memory_index_chunks_fts), path_exact, path_lexical (two SQL texts: the lexical and a substring/second variant), reconcile_count (unrelated derived-count statement, shown for completeness). sqlHash is the first 12 hex of sha256 of the whitespace-collapsed SQL; it differs between arms for the changed statements because the SQL text differs (`LIMIT +?`, `LIKE (? || '')`).\n\n";
let planOk = true;
for (const [name, f] of Object.entries(srcs)) {
  const b = planOf(f("before")), a = planOf(f("after"));
  pl += `## ${name}\n\n`;
  for (const shape of new Set([...Object.keys(b), ...Object.keys(a)])) {
    const bp = (b[shape] ?? []).map((x) => x.plan.join(" | ")); const ap = (a[shape] ?? []).map((x) => x.plan.join(" | "));
    const eq = JSON.stringify(bp) === JSON.stringify(ap); if (!eq) planOk = false;
    pl += `### ${shape}: before has ${bp.length} distinct SQL text(s), after has ${ap.length}; plans identical in order: ${eq}\n\n`;
    (b[shape] ?? []).forEach((x, i) => { pl += `before [${x.hash}] #${i + 1}:\n\`\`\`\n${x.plan.join("\n")}\n\`\`\`\nafter [${(a[shape] ?? [])[i]?.hash}] #${i + 1}:\n\`\`\`\n${((a[shape] ?? [])[i]?.plan ?? []).join("\n")}\n\`\`\`\n\n`; });
  }
}
pl += `\nVerdict: all plans identical between arms in every source: ${planOk}\n`;
fs.writeFileSync(`${P}/plans.md`, pl);
// gateway own latency lines
let lat = "";
for (const a of arms) for (const g of gruns) {
  const ms = [...rd(`${P}/gateway/${a}/${g}/openclaw.log`).matchAll(/res ✓ memory\.search (\d+)ms/g)].map((m) => Number(m[1]));
  const dd = ms.filter((_, i) => i % 2 === 0); // each line is logged twice (verified by pair equality below)
  const pairs = ms.length % 2 === 0 && ms.every((v, i) => i % 2 === 0 || v === ms[i - 1]);
  const s = [...dd.slice(10)].sort((x, y) => x - y);
  lat += `| ${a}/${g} | ${ms.length} lines, ${dd.length} unique (duplicated pairs: ${pairs}) | ${dd.join(" ")} | ${s[Math.floor((s.length - 1) / 2)]}-${s[Math.ceil((s.length - 1) / 2)]} |\n`;
}
fs.writeFileSync(`${P}/gateway-latency.md`, `| run | log lines | gateway-logged memory.search ms (per request, ms resolution) | median req 11-30 |\n|---|---|---|---|\n${lat}`);
console.log(par); console.log(planOk); console.log(lat);
