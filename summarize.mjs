// Build the summary table from the measure-rounds JSON files. Usage: node summarize.mjs <evidence-dir>
import { existsSync, readFileSync, writeFileSync } from "node:fs";
const ev = process.argv[2];
const rd = (s, m) => { const f = `${ev}/measure-admission-${s}-${m}.json`; return existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : undefined; };
const f = (v) => (v === undefined ? "n/a" : v.toFixed(1));
const cell = (j, arm, key = "admit_ms_median") => (j ? `${f(j.rounds[0][arm][key])} / ${f(j.rounds[1][arm][key])}` : "n/a");
let o = "Medians of 5 fresh processes per cell, milliseconds, schema admission (whole call). Cells are round1 / round2.\n";
o += "store | chunks | warm BEFORE | warm AFTER | cold BEFORE | cold AFTER | counts equal (canonical/FTS/docsize) | path taken\n";
for (const s of ["dev", "main"]) {
  const w = rd(s, "warm"), c = rd(s, "cold"), j = w ?? c; if (!j) continue;
  const r = j.rounds[0].before;
  const eq = [w, c].filter(Boolean).every((x) => x.rounds.every((rr) => rr.before.counts_equal && rr.after.counts_equal));
  const paths = [...new Set([w, c].filter(Boolean).flatMap((x) => x.rounds.flatMap((rr) => [...rr.before.paths, ...rr.after.paths])))].join(",");
  o += `${s} | ${r.canonical} | ${cell(w, "before")} | ${cell(w, "after")} | ${cell(c, "before")} | ${cell(c, "after")} | ${eq ? "yes" : "NO"} (${r.canonical}/${r.fts}/${r.docsize}) | ${paths}\n`;
}
o += "\nReconcile count statement alone (derived_count query), median ms, round1 / round2:\n";
o += "store | warm BEFORE | warm AFTER | cold BEFORE | cold AFTER\n";
for (const s of ["dev", "main"]) {
  const w = rd(s, "warm"), c = rd(s, "cold");
  o += `${s} | ${cell(w, "before", "stmt_ms_median")} | ${cell(w, "after", "stmt_ms_median")} | ${cell(c, "before", "stmt_ms_median")} | ${cell(c, "after", "stmt_ms_median")}\n`;
}
writeFileSync(`${ev}/measure-admission-summary.out`, o); console.log(o);
