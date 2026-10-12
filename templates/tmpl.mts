import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
const src = fs.readFileSync("src/agents/workspace.ts", "utf8");
const retired = [...src.matchAll(/"([a-f0-9]{64})"/g)].map((m) => m[1]);
const strip = (s: string) => { const m = s.match(/^---\n[\s\S]*?\n---\n/); return m ? s.slice(m[0].length).replace(/^\s+/, "") : s; };
const h = (s: string) => crypto.createHash("sha256").update(s).digest("hex");
const tags = process.argv.slice(2);
for (const f of ["SOUL.md", "IDENTITY.md", "USER.md", "AGENTS.md"]) {
  const cur = h(strip(fs.readFileSync(`docs/reference/templates/${f}`, "utf8")));
  const seen = new Map<string, string[]>();
  for (const t of tags) {
    let s: string; try { s = execFileSync("git", ["show", `${t}:docs/reference/templates/${f}`], { encoding: "utf8" }); } catch { continue; }
    const x = h(strip(s)); seen.set(x, [...(seen.get(x) ?? []), t]);
  }
  for (const [x, ts] of seen) console.log(f, x.slice(0, 16), x === cur ? "current" : retired.includes(x) ? "retired-listed" : "UNRECOGNIZED", `${ts[0]}..${ts.at(-1)} (${ts.length} tags)`);
}
