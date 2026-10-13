// Lists every difference between two digests: tables (rows added, removed, changed, with the changed
// fields; JSON columns are compared field by field), config leaves and files. usage: node compare.js <a.json> <b.json>
const fs = require("fs");
const [a, b] = process.argv.slice(2).map((f) => JSON.parse(fs.readFileSync(f, "utf8")));
const show = (v) => { const s = typeof v === "string" ? v : JSON.stringify(v); return s === undefined ? "(absent)" : s.length > 140 ? `${s.slice(0, 140)}...(${s.length} chars)` : s; };
const parse = (v) => { if (typeof v !== "string" || !/^[{[]/.test(v)) return undefined; try { return JSON.parse(v); } catch { return undefined; } };
const leaves = (o, p = "") => (o && typeof o === "object" ? Object.entries(o).flatMap(([k, v]) => leaves(v, p ? `${p}.${k}` : k)) : [[p, o]]);
let diffs = 0;
const line = (s) => { diffs++; console.log(s); };
for (const t of [...new Set([...Object.keys(a.tables), ...Object.keys(b.tables)])].sort()) {
  const x = a.tables[t], y = b.tables[t];
  if (!x || !y) { line(`table ${t}: ${x ? "removed" : "added"} (${(x ?? y).count} rows)`); continue; }
  if (x.sha === y.sha) continue;
  console.log(`table ${t}: ${x.count} -> ${y.count} rows`);
  for (const k of [...new Set([...Object.keys(x.rows), ...Object.keys(y.rows)])]) {
    const r = x.rows[k], s = y.rows[k];
    if (!r || !s) { line(`  row ${k} ${r ? "removed" : "added"}: ${show(r ?? s)}`); continue; }
    for (const col of [...new Set([...Object.keys(r), ...Object.keys(s)])]) {
      if (JSON.stringify(r[col]) === JSON.stringify(s[col])) continue;
      const pj = parse(r[col]), qj = parse(s[col]);
      if (pj && qj) {
        const lp = Object.fromEntries(leaves(pj)), lq = Object.fromEntries(leaves(qj));
        for (const f of [...new Set([...Object.keys(lp), ...Object.keys(lq)])].sort()) if (JSON.stringify(lp[f]) !== JSON.stringify(lq[f])) line(`  row ${k} ${col}.${f}: ${show(lp[f])} -> ${show(lq[f])}`);
      } else line(`  row ${k} ${col}: ${show(r[col])} -> ${show(s[col])}`);
    }
  }
}
for (const k of [...new Set([...Object.keys(a.config), ...Object.keys(b.config)])].sort()) if (JSON.stringify(a.config[k]) !== JSON.stringify(b.config[k])) line(`config ${k}: ${show(a.config[k])} -> ${show(b.config[k])}`);
for (const k of [...new Set([...Object.keys(a.files), ...Object.keys(b.files)])].sort()) if (a.files[k] !== b.files[k]) line(`file ${k}: ${a.files[k] ?? "(absent)"} -> ${b.files[k] ?? "(absent)"}`);
console.log(diffs ? `${diffs} differences` : "IDENTICAL");
