// Builds summary.md purely from the measure-<arm>-r<N>.out files in the evidence dir (no other numbers).
import { readFileSync, writeFileSync } from "node:fs";
const dir = process.argv[2];
const files = { "BEFORE r1": "measure-before-r1.out", "AFTER r1": "measure-after-r1.out", "AFTER r2": "measure-after-r2.out", "BEFORE r2": "measure-before-r2.out" };
const data = {}; // key: store|phase|case -> {run -> {median, hash, plan[]}}
const order = [];
const meta = {};
for (const [run, f] of Object.entries(files)) {
  const lines = readFileSync(`${dir}/${f}`, "utf8").split("\n");
  let store = "", title = "", phase = "", cas = "", plan = [];
  meta[run] = { before: lines.find((l) => l.startsWith("uptime before")), after: lines.find((l) => l.startsWith("uptime after")) };
  for (const l of lines) {
    let m;
    if ((m = l.match(/^######## store (\w): (.*)/))) { store = m[1]; title = m[2]; meta[store] = title; }
    else if ((m = l.match(/^===== store \w \/ (no ANALYZE|after ANALYZE)/))) phase = m[1];
    else if (l.startsWith("===== store e")) phase = "as-is";
    else if ((m = l.match(/^-- case: (.*)/))) { cas = m[1]; plan = []; }
    else if ((m = l.match(/^  plan: (.*)/))) plan.push(m[1]);
    else if ((m = l.match(/^RESULT \w+ r\d \| (.*?) \| 200 lookups median ([\d.]+) ms \[(.*?)\] \| records (\S+) \| hash (\w+)/))) {
      const key = `${store}|${phase}|${cas}`;
      if (!data[key]) { data[key] = {}; order.push(key); }
      data[key][run] = { median: +m[2], all: m[3], records: m[4], hash: m[5], plan: [...plan] };
    }
  }
}
let out = "# Reply lookup BEFORE/AFTER (production path)\n\nAll numbers are quoted from the measure-<arm>-r<N>.out files in this directory. Each cell: median ms of a 200-lookup sample (5 timed samples, 2 warm-ups); the 5 raw samples are in the .out files.\n\n";
out += "## Load readings (uptime before/after each run, from the .out files)\n\n| run | before | after |\n|---|---|---|\n";
for (const run of Object.keys(files)) out += `| ${run} | ${meta[run].before?.replace("uptime before: ", "")} | ${meta[run].after?.replace("uptime after: ", "")} |\n`;
for (const store of ["a", "b", "c", "d", "e"]) {
  out += `\n## Store ${store}: ${meta[store]}\n\n| phase | case | BEFORE r1 | AFTER r1 | AFTER r2 | BEFORE r2 | hash B1/A1/A2/B2 | hashes equal | r1 vs r2 spread |\n|---|---|---|---|---|---|---|---|---|\n`;
  for (const key of order.filter((k) => k.startsWith(store + "|"))) {
    const [, phase, cas] = key.split("|"); const d = data[key];
    const g = (r) => d[r]?.median;
    const hs = ["BEFORE r1", "AFTER r1", "AFTER r2", "BEFORE r2"].map((r) => d[r]?.hash);
    const spread = ["BEFORE", "AFTER"].map((a) => { const x = g(`${a} r1`), y = g(`${a} r2`); const s = x && y ? (Math.abs(x - y) / Math.min(x, y)) * 100 : NaN; return `${a} ${s.toFixed(1)}%${s > 10 ? " (>10%)" : ""}`; }).join("; ");
    out += `| ${phase} | ${cas} | ${g("BEFORE r1")} | ${g("AFTER r1")} | ${g("AFTER r2")} | ${g("BEFORE r2")} | ${hs.join(" / ")} | ${new Set(hs).size === 1 ? "yes" : "NO"} | ${spread} |\n`;
  }
  out += `\n### EXPLAIN QUERY PLAN of the captured production SQL (store ${store})\n\n`;
  const seen = new Set();
  for (const key of order.filter((k) => k.startsWith(store + "|"))) {
    const [, phase, cas] = key.split("|");
    for (const run of Object.keys(files)) {
      const p = data[key][run]?.plan; if (!p) continue;
      const sig = `${run.split(" ")[0]}|${phase}|${cas}|${p.join("/")}`; if (seen.has(sig)) continue; seen.add(sig);
      out += `- ${run.split(" ")[0]} / ${phase} / ${cas}: ${p.join(" ; ")}${["BEFORE r1","BEFORE r2","AFTER r1","AFTER r2"].filter(r=>r.startsWith(run.split(" ")[0])&&data[key][r]&&data[key][r].plan.join("/")!==p.join("/")).length?" (DIFFERS between rounds)":""}\n`;
    }
  }
}
writeFileSync(`${dir}/summary.md`, out);
console.log(out);
