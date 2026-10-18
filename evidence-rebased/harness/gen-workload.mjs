#!/usr/bin/env node
// Seeded synthetic memory workspace for the t2-03 proof.
// usage: node gen-workload.mjs <workspace-dir> <W1|W2|W3>
//   W1 many small files: 240 files, 1000-4200 chars each (about 1-3 chunks), published in groups of up to 8 sources
//   W2 large files: 4 files of ~90 KB each (about 64+ chunks each; staged path)
//   W3 mix: 60 small files + 2 files of ~55 KB (about 40 chunks each)
// File memory/w-000.md carries the token "copperwillow". Prints a JSON digest (sizes and sha256 only).
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const [, , dir, workload] = process.argv;
const PLAN = {
  W1: { small: 240, large: 0, largeChars: 0 },
  W2: { small: 0, large: 4, largeChars: 90000 },
  W3: { small: 60, large: 2, largeChars: 55000 },
}[workload];
if (!dir || !PLAN) { console.error("usage: gen-workload.mjs <dir> <W1|W2|W3>"); process.exit(2); }
const WORDS = ("lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua " +
  "enim ad minim veniam quis nostrud exercitation ullamco laboris nisi aliquip ex ea commodo consequat duis aute irure reprehenderit " +
  "voluptate velit esse cillum fugiat nulla pariatur excepteur sint occaecat cupidatat non proident sunt culpa officia deserunt mollit " +
  "anim id est laborum harbor lantern meadow saffron glacier orchard cobalt ember thistle quartz ridge delta willow").split(" ");
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function body(seed, chars, marker) {
  const rand = mulberry32(seed);
  const lines = [];
  let total = 0;
  while (total < chars) {
    const n = 10 + Math.floor(rand() * 8);
    const w = Array.from({ length: n }, () => WORDS[Math.floor(rand() * WORDS.length)]);
    const line = `${w.join(" ")}.`;
    lines.push(line);
    total += line.length + 1;
  }
  if (marker) lines[2] = `${lines[2]} Early marker ${marker}.`;
  return lines.join("\n");
}
const seedBase = { W1: 1000, W2: 2000, W3: 3000 }[workload];
const files = [];
let idx = 0;
const rand = mulberry32(seedBase);
for (let i = 0; i < PLAN.small; i++, idx++) files.push({ name: `w-${String(idx).padStart(3, "0")}.md`, chars: 1000 + Math.floor(rand() * 3200), seed: seedBase + idx });
for (let i = 0; i < PLAN.large; i++, idx++) files.push({ name: `w-${String(idx).padStart(3, "0")}.md`, chars: PLAN.largeChars, seed: seedBase + idx });
fs.mkdirSync(path.join(dir, "memory"), { recursive: true });
const all = crypto.createHash("sha256");
let bytes = 0;
files.forEach((f, i) => {
  const text = `# Synthetic ${workload} note ${i}\n\n${body(f.seed, f.chars, i === 0 ? "copperwillow" : "")}\n`;
  fs.writeFileSync(path.join(dir, "memory", f.name), text);
  all.update(f.name).update("\0").update(text).update("\0");
  bytes += Buffer.byteLength(text);
});
console.log(JSON.stringify({ workload, files: files.length, bytes, sha256: all.digest("hex") }));
