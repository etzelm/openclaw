#!/usr/bin/env node
// Scrubs every text file under <dir> in place. Machine-specific values are passed in through the
// environment (none appear in this script): SCRUB_SCRATCH (the proof's work directory, becomes
// <scratch>), SCRUB_HOME (becomes <home>), SCRUB_HOSTS (comma-separated host names, become <host>).
// Loopback address and port become <loopback>:<port>; temp directories become <tmp>.
import fs from "node:fs";
import path from "node:path";

const dir = process.argv[2];
const pairs = [
  [process.env.SCRUB_SCRATCH, "<scratch>"],
  [process.env.SCRUB_HOME, "<home>"],
  ...String(process.env.SCRUB_HOSTS ?? "").split(",").filter(Boolean).map((h) => [h, "<host>"]),
].filter(([from]) => from);
const regexes = [
  [/127\.0\.0\.1:\d+/g, "<loopback>:<port>"],
  [/\/(?:private\/)?var\/folders\/[^\s"')]+/g, "<tmp>"],
];
let files = 0;
function walk(p) {
  for (const e of fs.readdirSync(p, { withFileTypes: true })) {
    const f = path.join(p, e.name);
    if (e.isDirectory()) { walk(f); continue; }
    if (/\.(png|sqlite)$/.test(e.name)) continue;
    let s = fs.readFileSync(f, "utf8");
    const before = s;
    for (const [from, to] of pairs) s = s.split(from).join(to);
    for (const [re, to] of regexes) s = s.replace(re, to);
    if (s !== before) { fs.writeFileSync(f, s); files += 1; }
  }
}
walk(dir);
console.log(`scrubbed ${files} files`);
