#!/usr/bin/env node
// Deterministic synthetic memory workspace for the t1-02 real-behavior proof.
// Usage: node gen-synthetic-memory.mjs <workspace-dir> [files=400] [paragraphs=24]
// Writes <workspace-dir>/MEMORY.md and <workspace-dir>/memory/note-NNNN.md.
// Content is lorem-style text from a fixed word list and a seeded PRNG (mulberry32),
// so the same arguments always produce byte-identical files.
import fs from "node:fs";
import path from "node:path";

const [, , outDir, filesArg = "400", parasArg = "24"] = process.argv;
if (!outDir) {
  console.error("usage: gen-synthetic-memory.mjs <workspace-dir> [files] [paragraphs]");
  process.exit(2);
}
const FILES = Number(filesArg);
const PARAS = Number(parasArg);

const WORDS = (
  "lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore " +
  "et dolore magna aliqua enim ad minim veniam quis nostrud exercitation ullamco laboris nisi aliquip " +
  "ex ea commodo consequat duis aute irure in reprehenderit voluptate velit esse cillum fugiat nulla " +
  "pariatur excepteur sint occaecat cupidatat non proident sunt culpa qui officia deserunt mollit anim " +
  "id est laborum harbor lantern meadow copper willow saffron glacier orchard tundra cobalt ember"
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

const rand = mulberry32(175555);
const pick = () => WORDS[Math.floor(rand() * WORDS.length)];
function sentence() {
  const n = 8 + Math.floor(rand() * 10);
  const w = Array.from({ length: n }, pick);
  w[0] = w[0][0].toUpperCase() + w[0].slice(1);
  return `${w.join(" ")}.`;
}
function paragraph() {
  const n = 4 + Math.floor(rand() * 4);
  return Array.from({ length: n }, sentence).join(" ");
}

fs.mkdirSync(path.join(outDir, "memory"), { recursive: true });
fs.writeFileSync(
  path.join(outDir, "MEMORY.md"),
  `# Synthetic memory index\n\n${paragraph()}\n\nMarker phrase: saffron glacier orchard.\n`,
);
for (let i = 0; i < FILES; i += 1) {
  const name = `note-${String(i).padStart(4, "0")}.md`;
  const parts = [`# Note ${i}`];
  for (let p = 0; p < PARAS; p += 1) {
    parts.push(`## Section ${p}`, paragraph());
  }
  fs.writeFileSync(path.join(outDir, "memory", name), `${parts.join("\n\n")}\n`);
}
console.log(JSON.stringify({ outDir: path.basename(outDir), files: FILES, paragraphs: PARAS }));
