// summarize-delta.mjs: reads measure-delta-*-round*.out in a directory and prints the summary table.
// usage: node summarize-delta.mjs <dir>
import { readdirSync, readFileSync } from "node:fs";

const dir = process.argv[2];
const records = [];
const headers = [];
for (const name of readdirSync(dir).filter((n) => /^measure-delta-[AB]-round\d+\.out$/u.test(n)).sort()) {
  for (const line of readFileSync(`${dir}/${name}`, "utf8").split("\n")) {
    if (line.startsWith("{")) records.push(JSON.parse(line));
    else if (line.startsWith("# measure-delta") || line.startsWith("# fixture")) headers.push(`${name}: ${line}`);
  }
}
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const key = (r) => [r.store, r.size, r.mode, r.shape].join("|");
const groups = new Map();
for (const r of records) {
  const g = groups.get(key(r)) ?? { BEFORE: [], AFTER: [], rounds: {} };
  g[r.arm].push(r);
  groups.set(key(r), g);
}
const ops = (r) => {
  const c = r.row_ops.chunks ?? { ins: 0, del: 0 };
  return `${c.del}+${c.ins}`;
};
const PARITY = ["chunks", "fts", "recall", "provenance", "sources", "search"];
const rows = [];
let mismatches = 0;
for (const [k, g] of groups) {
  const [store, size, mode, shape] = k.split("|");
  const b = g.BEFORE;
  const a = g.AFTER;
  const bAll = b.flatMap((r) => r.runs_ms);
  const aAll = a.flatMap((r) => r.runs_ms);
  const equal = b.every((rb) => a.every((ra) => PARITY.every((p) => rb.parity[p] === ra.parity[p])));
  if (!equal) mismatches++;
  const perRound = (list) => list.map((r) => r.median_ms).join("/");
  rows.push([
    store.replace("agent store ", "").split(" ")[0],
    `${size} (${b[0].chunks_v1})`,
    mode,
    shape,
    `${median(bAll).toFixed(2)} (${perRound(b)})`,
    `${median(aAll).toFixed(2)} (${perRound(a)})`,
    (median(bAll) / median(aAll)).toFixed(2),
    ops(b[0]),
    ops(a[0]),
    `${b[0].revision_delta.revision}/${a[0].revision_delta.revision}`,
    `${b[0].wal.bytes}/${a[0].wal.bytes}`,
    equal ? "yes" : "NO",
  ]);
}
const head = [
  "store",
  "size (chunks)",
  "mode",
  "shape",
  "BEFORE median ms (per round)",
  "AFTER median ms (per round)",
  "B/A",
  "BEFORE chunk rows del+ins",
  "AFTER chunk rows del+ins",
  "revision delta B/A",
  "WAL bytes B/A",
  "parity equal",
];
const order = (r) => r[0] + r[1].split(" ")[0] + r[2] + r[3];
rows.sort((x, y) => (order(x) < order(y) ? -1 : 1));
console.log("# Summary: true median of 10 pooled runs (2 rounds x 5); per-round medians (of 5) in parentheses.");
console.log("# Stores: A = agent store A (430,518,272 bytes), B = agent store B (4,855,853,056 bytes).");
console.log("# Row ops are from one committed run. Shapes: S1 append, S2 last-chunk edit, S3 trailing removal, S4 top-of-file edit, S5 file deletion.");
console.log(head.join(" | "));
for (const r of rows) console.log(r.join(" | "));
console.log(`# parity mismatches: ${mismatches}`);
console.log("# AFTER plan (retained/written/removed, from the committed run):");
for (const [k, g] of groups) {
  const p = g.AFTER[0]?.plan;
  if (p) console.log(`#   ${k.replace(/^agent store /u, "").split(" (")[0]}${k.slice(k.indexOf("|"))}: incremental=${p.incremental} retained=${p.retained} written=${p.written} removed=${p.removed} prepared=${p.prepared_chunks}`);
}
console.log("# Headers:");
for (const h of headers) console.log(`#   ${h}`);
