#!/usr/bin/env node
// Deterministic synthetic memory file for the t2-02 shipped-entry-point proof.
// usage: node gen-synthetic-notes.mjs <workspace-dir> <paragraphs> [append]
//   without "append": writes <workspace-dir>/memory/synthetic-notes.md with one heading and
//   <paragraphs> generated paragraphs. Paragraph 3 carries the marker "copperwillow".
//   with "append": appends one generated paragraph carrying the marker "tundrabeacon".
// Text comes from a fixed word list and a seeded PRNG (mulberry32), so the same arguments
// always produce byte-identical content. No real memory content is involved.
import fs from "node:fs";
import path from "node:path";

const [, , outDir, parasArg, mode] = process.argv;
if (!outDir || !parasArg) {
  console.error("usage: gen-synthetic-notes.mjs <workspace-dir> <paragraphs> [append]");
  process.exit(2);
}
const WORDS = (
  "lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore " +
  "et dolore magna aliqua enim ad minim veniam quis nostrud exercitation ullamco laboris nisi aliquip " +
  "ex ea commodo consequat duis aute irure in reprehenderit voluptate velit esse cillum fugiat nulla " +
  "pariatur excepteur sint occaecat cupidatat non proident sunt culpa qui officia deserunt mollit anim " +
  "id est laborum harbor lantern meadow saffron glacier orchard cobalt ember"
).split(" ");
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(mode === "append" ? 175609 : 175608);
const pick = () => WORDS[Math.floor(rand() * WORDS.length)];
function sentence() {
  const w = Array.from({ length: 8 + Math.floor(rand() * 10) }, pick);
  w[0] = w[0][0].toUpperCase() + w[0].slice(1);
  return `${w.join(" ")}.`;
}
const paragraph = () => Array.from({ length: 4 + Math.floor(rand() * 4) }, sentence).join(" ");
const file = path.join(outDir, "memory", "synthetic-notes.md");
fs.mkdirSync(path.dirname(file), { recursive: true });
if (mode === "append") {
  fs.appendFileSync(file, `\n${paragraph()} Appended marker tundrabeacon.\n`);
} else {
  const parts = ["# Synthetic notes"];
  for (let p = 0; p < Number(parasArg); p += 1) {
    parts.push(p === 3 ? `${paragraph()} Early marker copperwillow.` : paragraph());
  }
  fs.writeFileSync(file, `${parts.join("\n\n")}\n`);
}
const text = fs.readFileSync(file, "utf8");
console.log(JSON.stringify({ file: "memory/synthetic-notes.md", mode: mode ?? "create", bytes: Buffer.byteLength(text), lines: text.split("\n").length - 1 }));
