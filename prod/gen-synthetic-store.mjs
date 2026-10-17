// usage: node gen-synthetic-store.mjs <arm-root> <out.sqlite> <unicode61|trigram> <queries.json>
// Builds a deterministic synthetic memory store (~3000 chunks over ~300 paths, some non-ASCII names)
// with the arm's BUILT ensureMemoryIndexSchema (same call and insert shape as
// extensions/memory-core/src/memory/manager-search.test-support.ts). Content is lorem-style text.
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { resolveExport } from "./resolve-dist.mjs";

const [, , armRoot, outPath, tokenizer, queriesPath] = process.argv;
fs.rmSync(outPath, { force: true });
const ensure = await resolveExport(armRoot, "ensureMemoryIndexSchema");
const db = new DatabaseSync(outPath);
const schema = ensure.fn({ db, cacheEnabled: false, ftsEnabled: true, ftsTokenizer: tokenizer });
if (!schema.ftsAvailable) throw new Error(`fts unavailable: ${schema.ftsError}`);

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
const rand = mulberry32(20261017);
const WORDS = (
  "lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore " +
  "et dolore magna aliqua enim ad minim veniam quis nostrud exercitation ullamco laboris nisi aliquip " +
  "harbor lantern meadow copper willow saffron glacier orchard tundra cobalt ember memory project notes " +
  "config agent session update error café naïve 東京 résumé"
).split(" ");
const pick = () => WORDS[Math.floor(rand() * WORDS.length)];
const sentence = () => `${Array.from({ length: 8 + Math.floor(rand() * 10) }, pick).join(" ")}.`;
const chunkText = () => Array.from({ length: 4 + Math.floor(rand() * 5) }, sentence).join(" ");

const pad = (n, w = 3) => String(n).padStart(w, "0");
const paths = ["MEMORY.md", "memory/config.md", "memory/README.md"];
for (let i = 0; i < 170; i++) paths.push(`memory/notes-${pad(i)}.md`);
for (let i = 0; i < 40; i++) paths.push(`memory/projects/alpha-${pad(i, 2)}.md`);
for (let i = 0; i < 30; i++) paths.push(`memory/café-${pad(i, 2)}.md`);
for (let i = 0; i < 30; i++) paths.push(`memory/naïve-plan-${pad(i, 2)}.md`);
for (let i = 0; i < 30; i++) paths.push(`memory/東京-${pad(i, 2)}.md`);
const insSrc = db.prepare("INSERT OR IGNORE INTO memory_index_sources (path, source, hash, mtime, size) VALUES (?, 'memory', ?, 0, 0)");
const insChunk = db.prepare(
  "INSERT INTO memory_index_chunks (id, path, source, start_line, end_line, hash, model, text, embedding, updated_at) VALUES (?, ?, 'memory', ?, ?, ?, 'mock-embed', ?, ?, 0)",
);
let chunks = 0;
db.exec("BEGIN");
paths.forEach((p, pi) => {
  insSrc.run(p, `${p}:hash`);
  for (let c = 0; c < 10; c++) {
    insChunk.run(`c-${pad(pi, 4)}-${c}`, p, c * 5 + 1, c * 5 + 5, `h-${pi}-${c}`, chunkText(), Buffer.from("[0]"));
    chunks++;
  }
});
db.exec("COMMIT");
const n = (t) => db.prepare(`SELECT count(*) c FROM ${t}`).get().c;
console.log(JSON.stringify({ tokenizer, paths: paths.length, chunks, ftsRows: n("memory_index_chunks_fts"), pathFtsRows: n("memory_index_paths_fts"), sqlite: process.versions.sqlite }));
db.close();
const queries = [
  "memory", "project", "notes", "config", "agent", "session", "update", "error",
  "notes-007", "alpha-03", "café", "cafe", "naïve", "naïve".normalize("NFD"), "東京", "東京-05",
  "café".normalize("NFD"), "willow saffron", "config.md", "zzzzqx unmatched",
];
fs.writeFileSync(queriesPath, JSON.stringify(queries));
