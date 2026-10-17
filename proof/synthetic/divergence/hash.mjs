import fs from "node:fs"; import crypto from "node:crypto";
for (const f of process.argv.slice(2)) { const j = JSON.parse(fs.readFileSync(f, "utf8")); const h = crypto.createHash("sha256").update(JSON.stringify(j.results.map((h) => [h.path, h.startLine, h.endLine, h.score]))).digest("hex"); console.log(`${h} hits=${j.results.length} ${f.replace(process.env.HOME,"~")}`); }
