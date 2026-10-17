import fs from "node:fs";
const S = JSON.parse(fs.readFileSync("raw/summary-numbers.json", "utf8"));
const f1 = (x) => x.toFixed(1);
const rows = [];
const add = (what, store, val, src) => rows.push(`| ${what} | ${store} | ${val} | ${src} |`);
const names = { dev: "dev (6,012 chunks)", main: "main (43,634 chunks)", "synthetic-unicode61": "synthetic unicode61 (3,030)", "synthetic-trigram": "synthetic trigram (3,030)" };
const file = (id, kind) => (id.startsWith("synthetic") ? `${id}.out`.replace("synthetic-", "synthetic-") : `${kind}-${id}.out`);
for (const id of Object.keys(names)) {
  const s = S[id];
  const src = (kind) => (id.startsWith("synthetic") ? `${id}.out` : `${kind}-${id}.out`);
  const t = s.timing;
  add("us/search BEFORE, protocol median of 10 rep means", names[id], f1(t.before), src("timing"));
  add("us/search AFTER, protocol median of 10 rep means", names[id], f1(t.after), src("timing"));
  add("saving us and percent, protocol", names[id], `${f1(t.saving)} us (${f1(t.pct)} percent)`, src("timing"));
  add("round 1 medians before/after", names[id], `${f1(t.rounds["1:before"])} / ${f1(t.rounds["1:after"])}`, src("timing"));
  add("round 2 medians before/after", names[id], `${f1(t.rounds["2:before"])} / ${f1(t.rounds["2:after"])}`, src("timing"));
  add("load1 at start of the 4 protocol runs", names[id], t.loads.join(", "), src("timing"));
  if (s.supp) {
    add("supplemental 8 runs (ABBA ABBA) before/after, median of 20 rep means", names[id], `${f1(s.supp.before)} / ${f1(s.supp.after)}, saving ${f1(s.supp.saving)} us (${f1(s.supp.pct)} percent)`, src("timing"));
    add("combined protocol + supplemental (30 rep means per arm)", names[id], `${f1(s.supp.combinedBefore)} / ${f1(s.supp.combinedAfter)}, saving ${f1(s.supp.combinedSaving)} us (${f1(s.supp.combinedPct)} percent)`, src("timing"));
  }
  add("parity (sha256 of full result object)", names[id], `${s.parity} identical; body rows ${s.bodyTot}, path rows ${s.pathTot}`, id.startsWith("synthetic") ? `${id}.out` : `parity-${id}.out`);
  add("plans identical vs different (statements)", names[id], `${s.plans}; ${s.shapes} statement shapes`, id.startsWith("synthetic") ? `${id}.out` : `plans-${id}.out`);
  add("memory_index_chunks READ callbacks per search, searches 1-10 BEFORE", names[id], s.compBefore.join(" "), id.startsWith("synthetic") ? `${id}.out` : `compiles-${id}.out`);
  add("memory_index_chunks READ callbacks per search, searches 1-10 AFTER", names[id], s.compAfter.join(" "), id.startsWith("synthetic") ? `${id}.out` : `compiles-${id}.out`);
  add("db.function registrations per search, searches 1-10 BEFORE", names[id], s.fnBefore.join(" "), id.startsWith("synthetic") ? `${id}.out` : `compiles-${id}.out`);
  add("db.function registrations per search, searches 1-10 AFTER", names[id], s.fnAfter.join(" "), id.startsWith("synthetic") ? `${id}.out` : `compiles-${id}.out`);
}
const text = `# Summary (all numbers quoted from the named files; times are microseconds per search through the built searchKeywordWithFallback)\n\n| quantity | store | value | source file |\n|---|---|---|---|\n${rows.join("\n")}\n\nOther files: params.md (derivations, connection method), dist-diff.out (built-code diff), env.out (machine, versions), scripts (measure-search.mjs, lib.mjs, resolve-dist.mjs, gen-synthetic-store.mjs, drive-*.sh, run-aux.sh, report.mjs, summary.mjs, probe-open.mjs), raw/ (per-run JSON and logs; no row content).\n`;
fs.writeFileSync("summary.md", text.replaceAll("<scratch>/t1-01-ev", "<scratch>").replaceAll("<home>", "<home>"));
