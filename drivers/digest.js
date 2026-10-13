// Digest of everything an OpenClaw profile stores: every table of every *.sqlite under <profile>/state
// (row count, table sha256, each row's normalized content), config leaves, workspace files and Claude
// project transcripts. Read-only (node:sqlite, readOnly), no OpenClaw code. usage: node digest.js <profile> <out.json>
const fs = require("fs"), path = require("path"), crypto = require("crypto");
const { DatabaseSync } = require("node:sqlite");
const P = path.resolve(process.argv[2]);
const sha = (s) => crypto.createHash("sha256").update(s).digest("hex").slice(0, 16);
const norm = (s) => s.split(P).join("<profile>");
const walk = (d) => (fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)])) : []);
const out = { tables: {}, config: {}, files: {} };
for (const f of walk(path.join(P, "state")).filter((f) => f.endsWith(".sqlite")).sort()) {
  const db = new DatabaseSync(f, { readOnly: true });
  for (const { name, sql } of db.prepare("select name, sql from sqlite_master where type='table' order by name").all()) {
    const noRowid = /WITHOUT ROWID/i.test(sql ?? "");
    const rows = db.prepare(`select ${noRowid ? "" : "rowid as __rowid, "}* from "${name}"${noRowid ? "" : " order by rowid"}`).all();
    const enc = rows.map((r) => {
      const o = {};
      for (const [k, v] of Object.entries(r)) o[k] = v instanceof Uint8Array ? `hex:${Buffer.from(v).toString("hex")}` : typeof v === "string" ? norm(v) : typeof v === "bigint" ? String(v) : v;
      return o;
    });
    const key = (o, i) => String(o.__rowid ?? Object.values(o)[0] ?? i);
    const t = (out.tables[`${norm(path.relative(P, f))}:${name}`] = { count: rows.length, sha: sha(JSON.stringify(enc)), rows: {} });
    enc.forEach((o, i) => { t.rows[key(o, i)] = o; });
  }
  db.close();
}
const leaves = (o, p = "") => (o && typeof o === "object" ? Object.entries(o).flatMap(([k, v]) => leaves(v, p ? `${p}.${k}` : k)) : [[p, o]]);
for (const [k, v] of leaves(JSON.parse(fs.readFileSync(path.join(P, "openclaw.json"), "utf8")))) out.config[k] = typeof v === "string" ? norm(v) : v;
for (const dir of ["workspace", ".claude/projects"]) for (const f of walk(path.join(P, dir)).sort()) if (!f.includes("/.git/")) out.files[norm(f)] = sha(fs.readFileSync(f));
fs.writeFileSync(process.argv[3], JSON.stringify(out));
const n = Object.values(out.tables).reduce((a, t) => a + t.count, 0);
console.log(`digest: ${Object.keys(out.tables).length} tables, ${n} rows, ${Object.keys(out.config).length} config leaves, ${Object.keys(out.files).length} files`);
