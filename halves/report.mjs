import fs from "node:fs";
const HOME = "<home>";
const SCR = `${HOME}/work/t1-01-ev`;
const scrub = (s) => s.replaceAll(SCR, "<scratch>").replaceAll(HOME, "<home>").replace(/[\u2013\u2014]/g, "-");
const R = (f) => JSON.parse(fs.readFileSync(`raw/${f}`, "utf8"));
const out = (n, t) => fs.writeFileSync(n, scrub(t) + "\n");
const median = (a) => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const f1 = (x) => x.toFixed(1);
const ARMS = ["BASE", "M1", "M2", "FULL"];
const STORES = [["dev", "real dev store (6,012 chunks)", 400], ["main", "real main store (43,634 chunks)", 200]];
const shadow = (k) => /^SQLITE_READ:.*_fts_(content|docsize|idx|data|config)$/.test(k);
const sum = (o, p) => Object.entries(o).filter(([k]) => p(k)).reduce((s, [, v]) => s + v, 0);
const S = {}; // numbers for summary
let md = "";
for (const [id, title, N] of STORES) {
  S[id] = {};
  // parity
  let t = `# parity: ${title}\nsha256 = sha256(JSON.stringify(result of searchKeywordWithFallback)); each arm vs BASE\n\n`;
  const base = R(`${id}-parity-BASE.json`);
  t += `node ${base.meta.node} sqlite ${base.meta.sqlite}\nconnection: ${base.meta.connectionMethod}\n\n`;
  for (const a of ARMS) {
    const r = R(`${id}-parity-${a}.json`);
    let same = 0;
    t += `## ${a} (${r.meta.searchFile})\nq     rows(body/path)  sha256                                                            same_as_BASE\n`;
    r.parity.forEach((x, i) => {
      const b = base.parity[i];
      const ok = x.sha256 === b.sha256 && x.bodyRows === b.bodyRows && x.pathRows === b.pathRows;
      if (ok) same++;
      t += `${x.q.padEnd(5)} ${`${x.bodyRows}/${x.pathRows}`.padEnd(16)} ${x.sha256} ${ok}\n`;
    });
    t += `identical to BASE: ${same}/${r.parity.length}; error results: ${r.parity.filter((x) => x.bodyError || x.pathError).length}\n\n`;
    S[id][a] = { parity: `${same}/${r.parity.length}` };
  }
  out(`parity-${id}.out`, t);
  // compiles
  t = `# compile counting: ${title}\nauthorizer via DatabaseSync.prototype.setAuthorizer.call before first search (statement cache stays on)\nper search: C = SQLITE_READ callbacks on memory_index_chunks, P = db.prepare calls, F = db.function registrations, T = total authorizer callbacks\nsteady state = median over searches 21-60 of the 60-search run (3 passes over 20 inputs, run in the same process after the first10 run)\n\n`;
  const rs = Object.fromEntries(ARMS.map((a) => [a, R(`${id}-compiles-${a}.json`).compiles]));
  for (const seq of ["first10", "all20x3"]) {
    t += `## ${seq}\nsearch q       | ${ARMS.map((a) => `${a.padEnd(4)} C   P  F    T`).join(" | ")}\n`;
    rs.BASE[seq].forEach((x, i) => {
      t += `${String(x.search).padStart(3)} ${String(x.q).padEnd(8)}| ` + ARMS.map((a) => { const y = rs[a][seq][i]; return `${String(y.compilesMemoryIndexChunks).padStart(8)} ${String(y.prepareCalls).padStart(3)} ${String(y.functionRegistrations).padStart(2)} ${String(y.authorizerCallbacksTotal).padStart(4)}`; }).join(" | ") + "\n";
    });
    t += `totals over ${seq}: ` + ARMS.map((a) => { const r = rs[a][seq]; const s = (k) => r.reduce((p, x) => p + x[k], 0); return `${a} C=${s("compilesMemoryIndexChunks")} P=${s("prepareCalls")} F=${s("functionRegistrations")} T=${s("authorizerCallbacksTotal")}`; }).join(" | ") + "\n\n";
  }
  out(`compiles-${id}.out`, t);
  // tables
  t = `# per-table authorizer callbacks, steady-state search 10 of first10 (input 'project', second use): ${title}\nFTS5 shadow tables = *_fts_content, *_fts_docsize, *_fts_idx, *_fts_data, *_fts_config\n\n`;
  const keys = [...new Set(ARMS.flatMap((a) => Object.keys(rs[a].first10[9].byAction)))].sort();
  t += `${"action:table".padEnd(46)} ${ARMS.map((a) => a.padStart(6)).join(" ")}\n`;
  for (const k of keys) t += `${k.padEnd(46)} ${ARMS.map((a) => String(rs[a].first10[9].byAction[k] ?? 0).padStart(6)).join(" ")}\n`;
  t += `${"TOTAL".padEnd(46)} ${ARMS.map((a) => String(sum(rs[a].first10[9].byAction, () => true)).padStart(6)).join(" ")}\n`;
  t += `${"FTS5 shadow-table READ subtotal".padEnd(46)} ${ARMS.map((a) => String(sum(rs[a].first10[9].byAction, shadow)).padStart(6)).join(" ")}\n`;
  t += `${"SQLITE_PRAGMA:data_version".padEnd(46)} ${ARMS.map((a) => String(rs[a].first10[9].byAction["SQLITE_PRAGMA:data_version"] ?? 0).padStart(6)).join(" ")}\n`;
  t += `\n## shadow-table callbacks per search across all 60 (min/median/max), steady state searches 21-60 and search 1\n`;
  for (const a of ARMS) {
    const per = rs[a].all20x3.map((x) => sum(x.byAction, shadow));
    const st = per.slice(20);
    t += `${a}: search1 ${per[0]}; searches 21-60 min ${Math.min(...st)} median ${median(st)} max ${Math.max(...st)}\n`;
  }
  out(`tables-${id}.out`, t);
  for (const a of ARMS) {
    const st = rs[a].all20x3.slice(20);
    const med = (k) => median(st.map((x) => x[k]));
    S[id][a] = { ...S[id][a], C: med("compilesMemoryIndexChunks"), F: med("functionRegistrations"), T: med("authorizerCallbacksTotal"), P: med("prepareCalls"),
      shadow: median(st.map((x) => sum(x.byAction, shadow))), C10: rs[a].first10[9].compilesMemoryIndexChunks, F10: rs[a].first10[9].functionRegistrations, T10: rs[a].first10[9].authorizerCallbacksTotal, shadow10: sum(rs[a].first10[9].byAction, shadow),
      pragma10: rs[a].first10[9].byAction["SQLITE_PRAGMA:data_version"] ?? 0,
      first10C: rs[a].first10.map((x) => x.compilesMemoryIndexChunks).join(" "), tot60C: rs[a].all20x3.reduce((p, x) => p + x.compilesMemoryIndexChunks, 0), tot60F: rs[a].all20x3.reduce((p, x) => p + x.functionRegistrations, 0), tot60T: rs[a].all20x3.reduce((p, x) => p + x.authorizerCallbacksTotal, 0) };
  }
  // timing skipped per coordinator instruction (load1 above 15)
  const LV = id === "dev" ? "70.72 at 13:29 (waits of 1200 s per run had not brought it below 6; 55 to 70 throughout)" : "70.72 at 13:29, main timing never started";
  out(`timing-${id}.out`, `timing skipped: load1 ${LV}\nCoordinator rule: skip timing when load1 is above 15 at run start. The driver was stopped after 3 dev runs under load1 about 39 to 54 (BASE, M1, M2 round 1 only, raw/timing-dev-run1..3); those numbers are not a protocol result and are not used.\n`);
  for (const a of ARMS) Object.assign(S[id][a], { us: NaN, sv: NaN, pct: NaN });
}
// summary.md
md += `# Summary: half-patched builds vs BASE vs FULL (all numbers from the named files; <scratch> = scratch dir)\n\nSteady-state per search = median over searches 21-60 of the 60-search run (compiles-<store>.out); search 10 values in tables-<store>.out.\n\n`;
for (const [id, title] of STORES) {
  md += `## ${title}\n\n| arm | memory_index_chunks compile reads per steady-state search | db.function per search | total callbacks per search | FTS5 shadow-table callbacks per search | timing | saving | parity vs BASE | source |\n|---|---|---|---|---|---|---|---|---|\n`;
  for (const a of ARMS) { const x = S[id][a]; md += `| ${a} | ${x.C} | ${x.F} | ${x.T} | ${x.shadow} | skipped | skipped | ${x.parity} | compiles-${id}.out, tables-${id}.out, timing-${id}.out, parity-${id}.out |\n`; }
  md += `\nmemory_index_chunks reads, searches 1-10 (compiles-${id}.out first10): ` + ARMS.map((a) => `${a}: ${S[id][a].first10C}`).join("; ") + `\n`;
  md += `\n60-search totals (compiles-${id}.out): ` + ARMS.map((a) => `${a} C=${S[id][a].tot60C} F=${S[id][a].tot60F} T=${S[id][a].tot60T}`).join("; ") + `\n`;
  md += `\nSearch 10 (tables-${id}.out): ` + ARMS.map((a) => `${a} total ${S[id][a].T10}, shadow ${S[id][a].shadow10}, data_version ${S[id][a].pragma10}, F ${S[id][a].F10}`).join("; ") + `\n`;
  md += `\nTiming: see timing-${id}.out (skipped, load1 above 15).\n\n`;
}
fs.writeFileSync("summary.md", scrub(md));
