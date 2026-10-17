// Builds *.out files and summary.md numbers from raw/*.json. Reads only counts/hashes/timings/plans.
import fs from "node:fs";
const HOME = "<home>";
const SCR = `${HOME}/work/t1-01-ev`;
const scrub = (s) => s.replaceAll(SCR, "<scratch>").replaceAll(HOME, "<home>").replace(/[\u2013\u2014]/g, "-");
const R = (f) => JSON.parse(fs.readFileSync(`raw/${f}`, "utf8"));
const has = (f) => fs.existsSync(`raw/${f}`);
const out = (name, text) => fs.writeFileSync(name, scrub(text) + "\n");
const median = (a) => {
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const f1 = (x) => x.toFixed(1);
const STORES = [
  { id: "dev", title: "real dev store (6,012 chunks)", real: true },
  { id: "main", title: "real main store (43,634 chunks)", real: true },
  { id: "synthetic-unicode61", title: "synthetic unicode61 (3,030 chunks, 303 paths)", real: false },
  { id: "synthetic-trigram", title: "synthetic trigram (3,030 chunks, 303 paths)", real: false },
];
const summary = {};

for (const S of STORES) {
  const outName = (kind) => (S.real ? `${kind}-${S.id}.out` : `${S.id.replace("synthetic-", "synthetic-")}-${kind}.out`);
  let synth = "";
  // ---- parity
  if (has(`${S.id}-parity-before.json`)) {
    const a = R(`${S.id}-parity-before.json`), b = R(`${S.id}-parity-after.json`);
    let t = `# parity: ${S.title}\nBEFORE chunk: ${a.meta.searchFile}\nAFTER chunk: ${b.meta.searchFile}\nconnection: ${a.meta.connectionMethod} | ${b.meta.connectionMethod}\nnode ${a.meta.node} sqlite ${a.meta.sqlite} tokenizer ${a.meta.tokenizer}\n`;
    t += `sha256 = sha256(JSON.stringify(result of searchKeywordWithFallback)); rows = body/path\n\n`;
    t += `${"q".padEnd(22)} rows(B) rows(A) sha256(before)                                                    sha256(after)                                                     same\n`;
    let same = 0, bodyTot = 0, pathTot = 0;
    a.parity.forEach((x, i) => {
      const y = b.parity[i];
      const ok = x.sha256 === y.sha256 && x.bodyRows === y.bodyRows && x.pathRows === y.pathRows;
      if (ok) same++;
      bodyTot += x.bodyRows; pathTot += x.pathRows;
      t += `${x.q.padEnd(22)} ${`${x.bodyRows}/${x.pathRows}`.padEnd(8)} ${`${y.bodyRows}/${y.pathRows}`.padEnd(7)} ${x.sha256} ${y.sha256} ${ok}\n`;
    });
    t += `\nidentical: ${same}/${a.parity.length}; body rows summed ${bodyTot}, path rows summed ${pathTot}; error results: ${a.parity.filter((x) => x.bodyError || x.pathError).length}\n`;
    summary[S.id] = { ...(summary[S.id] ?? {}), parity: `${same}/${a.parity.length}`, bodyTot, pathTot };
    if (S.real) out(`parity-${S.id}.out`, t); else synth += t + "\n";
  }
  // ---- compiles
  if (has(`${S.id}-compiles-before.json`)) {
    const a = R(`${S.id}-compiles-before.json`), b = R(`${S.id}-compiles-after.json`);
    let t = `# compile counting: ${S.title}\nauthorizer installed via DatabaseSync.prototype.setAuthorizer.call before the first search (repo instance wrapper bypassed, statement cache stays on)\nper search: C = SQLITE_READ callbacks on table memory_index_chunks (outer statement compiles x reads), P = db.prepare calls, F = db.function registrations, T = total authorizer callbacks\n\n`;
    for (const seq of ["first10", "all20x3"]) {
      t += `## ${seq}\nsearch q            |  BEFORE C   P  F    T |  AFTER C   P  F    T\n`;
      a.compiles[seq].forEach((x, i) => {
        const y = b.compiles[seq][i];
        t += `${String(x.search).padStart(3)} ${String(x.q).padEnd(15)} | ${String(x.compilesMemoryIndexChunks).padStart(10)} ${String(x.prepareCalls).padStart(3)} ${String(x.functionRegistrations).padStart(2)} ${String(x.authorizerCallbacksTotal).padStart(4)} | ${String(y.compilesMemoryIndexChunks).padStart(8)} ${String(y.prepareCalls).padStart(3)} ${String(y.functionRegistrations).padStart(2)} ${String(y.authorizerCallbacksTotal).padStart(4)}\n`;
      });
      const sum = (r, k) => r.reduce((s, x) => s + x[k], 0);
      t += `totals over ${seq}: BEFORE C=${sum(a.compiles[seq], "compilesMemoryIndexChunks")} P=${sum(a.compiles[seq], "prepareCalls")} F=${sum(a.compiles[seq], "functionRegistrations")} | AFTER C=${sum(b.compiles[seq], "compilesMemoryIndexChunks")} P=${sum(b.compiles[seq], "prepareCalls")} F=${sum(b.compiles[seq], "functionRegistrations")}\n\n`;
    }
    t += `## authorizer callbacks by action:table, search 1, 2, 3 and 10 of first10\n`;
    for (const [nm, r] of [["BEFORE", a], ["AFTER", b]]) for (const k of [0, 1, 2, 9]) t += `${nm} search ${k + 1}: ${JSON.stringify(r.compiles.first10[k].byAction)}\n`;
    summary[S.id] = {
      ...(summary[S.id] ?? {}),
      compBefore: a.compiles.first10.map((x) => x.compilesMemoryIndexChunks),
      compAfter: b.compiles.first10.map((x) => x.compilesMemoryIndexChunks),
      fnBefore: a.compiles.first10.map((x) => x.functionRegistrations),
      fnAfter: b.compiles.first10.map((x) => x.functionRegistrations),
      fnBeforeTotal: a.compiles.all20x3.reduce((s, x) => s + x.functionRegistrations, 0) + a.compiles.first10.reduce((s, x) => s + x.functionRegistrations, 0),
      fnAfterTotal: b.compiles.all20x3.reduce((s, x) => s + x.functionRegistrations, 0) + b.compiles.first10.reduce((s, x) => s + x.functionRegistrations, 0),
    };
    if (S.real) out(`compiles-${S.id}.out`, t); else synth += t + "\n";
  }
  // ---- plans
  if (has(`${S.id}-plans-before.json`)) {
    const a = R(`${S.id}-plans-before.json`), b = R(`${S.id}-plans-after.json`);
    let nst = 0, ident = 0, diff = 0;
    const perShape = new Map();
    let perQuery = "";
    a.plans.forEach((q, i) => {
      const o = b.plans[i];
      let qi = 0, qd = 0;
      q.statements.forEach((st, j) => {
        nst++;
        const other = o.statements[j];
        const same = other && other.shape === st.shape && JSON.stringify(other.plan) === JSON.stringify(st.plan);
        if (same) { ident++; qi++; } else { diff++; qd++; }
        const e = perShape.get(st.shape) ?? { n: 0, variants: new Map(), rawDiffers: 0 };
        e.n++;
        e.variants.set(JSON.stringify(st.plan), (e.variants.get(JSON.stringify(st.plan)) ?? 0) + 1);
        if (other && other.rawSqlSha !== st.rawSqlSha) e.rawDiffers++;
        perShape.set(st.shape, e);
      });
      perQuery += `${q.statements.length === o.statements.length ? "" : "STATEMENT COUNT DIFFERS "}${q.q.padEnd(22)} statements ${String(q.statements.length).padStart(2)}  plans identical ${qi}  different ${qd}\n`;
    });
    let t = `# query plans (EXPLAIN QUERY PLAN with the same bound parameters on the same connection): ${S.title}\nsqlite ${a.meta.sqlite}; statements = every statement executed by searchKeywordWithFallback for the ${a.plans.length} inputs (bound values never printed)\n\n`;
    t += `RESULT: ${nst} statements compared BEFORE vs AFTER (matched by position within each search and by SQL shape): plans identical ${ident}, different ${diff}\n\n`;
    t += `## per query\n${perQuery}\n## per statement shape (shape = sha256 of SQL with 'LIMIT +?' -> 'LIMIT ?' and "(? || '')" -> '?' normalized; BEFORE and AFTER raw SQL differ in ${[...perShape.values()].filter((e) => e.rawDiffers > 0).length}/${perShape.size} shapes)\n`;
    for (const [shape, e] of perShape) {
      t += `\n### shape ${shape}: ${e.n} executions; raw SQL differs between arms in ${e.rawDiffers} of them\nnormalized SQL: ${a.shapes[shape].normalizedSql}\n`;
      let v = 0;
      for (const [plan, cnt] of e.variants) {
        v++;
        t += `plan variant ${v} (${cnt} executions), id|parent|detail:\n${JSON.parse(plan).map((l) => "  " + l).join("\n")}\n`;
      }
    }
    summary[S.id] = { ...(summary[S.id] ?? {}), plans: `${ident}/${nst} identical, ${diff} different`, shapes: perShape.size };
    if (S.real) out(`plans-${S.id}.out`, t); else synth += t + "\n";
  }
  // ---- timing
  const runs = [];
  for (let i = 1; i <= 4; i++) {
    const f = fs.readdirSync("raw").find((x) => x.startsWith(`timing-${S.id}-run${i}-r`) && x.endsWith(".json") && !x.endsWith("load.json"));
    if (f) runs.push({ i, ...R(f), load: R(`timing-${S.id}-run${i}-load.json`), file: f });
  }
  if (runs.length === 4) {
    const armOf = (r) => (r.file.includes("-before") ? "before" : "after");
    const roundOf = (r) => Number(r.file.match(/-r(\d)-/)[1]);
    let t = `# timing: ${S.title}\nsearches per rep ${runs[0].timing.searchesPerRep}, 2 warm-up passes over 20 inputs, 5 reps per run, fresh node process per run; order BEFORE, AFTER, AFTER, BEFORE\nconnection: ${runs[0].meta.connectionMethod}\nnode ${runs[0].meta.node} sqlite ${runs[0].meta.sqlite}\n\n`;
    t += `run round arm    load1@start load1@end waited_s | rep means (us per search) | median | script_wall_ms process_uptime_ms\n`;
    const byArm = { before: [], after: [] };
    const perRound = {};
    for (const r of runs) {
      const arm = armOf(r), rd = roundOf(r), m = median(r.timing.repMeansUs);
      byArm[arm].push(...r.timing.repMeansUs);
      perRound[`${rd}:${arm}`] = m;
      t += `${r.i}   ${rd}     ${arm.padEnd(6)} ${String(r.load.load1AtStart).padStart(10)} ${String(r.load.load1AtEnd).padStart(9)} ${String(r.load.waitedSeconds).padStart(8)} | ${r.timing.repMeansUs.map(f1).join(" ")} | ${f1(m)} | ${Math.round(r.wallMs)} ${Math.round(r.processUptimeMs)}\n`;
    }
    const mb = median(byArm.before), ma = median(byArm.after);
    t += `\n## per-round medians of the 5 rep means (us)\n`;
    for (const rd of [1, 2]) t += `round ${rd}: BEFORE ${f1(perRound[`${rd}:before`])}  AFTER ${f1(perRound[`${rd}:after`])}  saving ${f1(perRound[`${rd}:before`] - perRound[`${rd}:after`])} us (${f1(((perRound[`${rd}:before`] - perRound[`${rd}:after`]) / perRound[`${rd}:before`]) * 100)} percent)\n`;
    t += `\n## overall median over all 10 rep means per arm (us per search)\nBEFORE ${f1(mb)}  AFTER ${f1(ma)}  saving ${f1(mb - ma)} us (${f1(((mb - ma) / mb) * 100)} percent)\n`;
    const spread = (a) => `${f1(Math.min(...a))}..${f1(Math.max(...a))}`;
    t += `rep-mean range: BEFORE ${spread(byArm.before)}  AFTER ${spread(byArm.after)}\n`;
    const wb = runs.filter((r) => armOf(r) === "before").map((r) => r.processUptimeMs), wa = runs.filter((r) => armOf(r) === "after").map((r) => r.processUptimeMs);
    t += `process wall (node start to exit, ms): BEFORE ${wb.map(Math.round).join(", ")}  AFTER ${wa.map(Math.round).join(", ")}  (whole process: module load plus all searches; includes about 1,080 searches on main, 2,040 on dev and synthetic)\n`;
    // supplemental runs (beyond the protocol)
    const sup = fs.readdirSync("raw").filter((x) => x.startsWith(`supp-${S.id}-run`) && x.endsWith(".json") && !x.endsWith("load.json")).sort((p, q) => Number(p.match(/run(\d+)/)[1]) - Number(q.match(/run(\d+)/)[1]));
    if (sup.length > 0) {
      t += `\n## supplemental runs (not part of the 2-round protocol; same harness, order ABBA ABBA = before after after before before after after before)\nrun arm    load1@start load1@end waited_s | rep means (us) | median\n`;
      const sb = [], sa = [];
      sup.forEach((f) => {
        const r = R(f), arm = f.includes("-before") ? "before" : "after", ld = R(f.replace(/-(before|after)\.json$/, "-load.json"));
        (arm === "before" ? sb : sa).push(...r.timing.repMeansUs);
        t += `${f.match(/run(\d+)/)[1].padEnd(3)} ${arm.padEnd(6)} ${String(ld.load1AtStart).padStart(10)} ${String(ld.load1AtEnd).padStart(9)} ${String(ld.waitedSeconds).padStart(8)} | ${r.timing.repMeansUs.map(f1).join(" ")} | ${f1(median(r.timing.repMeansUs))}\n`;
      });
      const m1 = median(sb), m2 = median(sa);
      t += `supplemental overall median over ${sb.length} rep means per arm: BEFORE ${f1(m1)}  AFTER ${f1(m2)}  saving ${f1(m1 - m2)} us (${f1(((m1 - m2) / m1) * 100)} percent)\n`;
      const ab = [...byArm.before, ...sb], aa = [...byArm.after, ...sa];
      const c1 = median(ab), c2 = median(aa);
      t += `combined protocol + supplemental median over ${ab.length} rep means per arm: BEFORE ${f1(c1)}  AFTER ${f1(c2)}  saving ${f1(c1 - c2)} us (${f1(((c1 - c2) / c1) * 100)} percent)\n`;
      const pairs = [];
      for (let k = 0; k + 1 < sup.length; k += 2) {}
      summary[S.id] = { ...(summary[S.id] ?? {}), supp: { before: m1, after: m2, saving: m1 - m2, pct: ((m1 - m2) / m1) * 100, combinedBefore: c1, combinedAfter: c2, combinedSaving: c1 - c2, combinedPct: ((c1 - c2) / c1) * 100 } };
    }
    summary[S.id] = { ...(summary[S.id] ?? {}), timing: { before: mb, after: ma, saving: mb - ma, pct: ((mb - ma) / mb) * 100, rounds: perRound, wallB: wb, wallA: wa, loads: runs.map((r) => r.load.load1AtStart) } };
    if (S.real) out(`timing-${S.id}.out`, t); else synth += t + "\n";
  }
  if (!S.real && synth) out(`synthetic-${S.id.replace("synthetic-", "")}.out`, `# ${S.title}\nqueries (publishable): ${has(`${S.id}-parity-before.json`) ? fs.readFileSync("synthetic-queries.json", "utf8") : ""}\n\n` + synth);
}
fs.writeFileSync("raw/summary-numbers.json", JSON.stringify(summary, null, 1));
console.log(JSON.stringify(summary, null, 1).slice(0, 4000));
