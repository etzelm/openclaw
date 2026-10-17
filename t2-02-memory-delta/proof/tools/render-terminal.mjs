#!/usr/bin/env node
// Renders a condensed view of one run's transcript.txt as terminal-styled HTML, for a headless
// Chrome screenshot. It is a rendering of the captured transcript, not a live terminal.
// Large JSON bodies are reduced to their path, line range, score and count fields.
// usage: node render-terminal.mjs <run-dir> <summary.out> <out.html>
import fs from "node:fs";
import path from "node:path";
const [, , run, summaryFile, outFile] = process.argv;
const name = path.basename(run);
const keep = /"(path|startLine|endLine|chunks|files|dirty|state)":/;
const lines = [];
let depth = 0;
for (const line of fs.readFileSync(path.join(run, "transcript.txt"), "utf8").split("\n")) {
  if (/^  /.test(line) && depth === 0) continue; // config block (shown in openclaw.json)
  if (/^[\[{]$/.test(line.trim()) && depth === 0) { depth = 1; lines.push(line); continue; }
  if (depth > 0) {
    if (/^[\]}]$/.test(line)) { depth = 0; lines.push(line); continue; }
    if (keep.test(line)) lines.push(line.replace(/^\s+/, "    "));
    continue;
  }
  lines.push(line);
}
const summary = fs.readFileSync(summaryFile, "utf8").split("\n");
const header = summary[0].split(" | ");
const row = summary.find((l) => l.startsWith(`${name} |`))?.split(" | ") ?? [];
lines.push("", `# summarize.mjs row for ${name}:`);
header.forEach((h, i) => lines.push(`#   ${h}: ${row[i] ?? ""}`));
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const body = lines.map((l) => {
  const cls = l.startsWith("$ ") ? "cmd" : l.startsWith("#") ? "note" : "";
  return `<div class="${cls}">${esc(l) || "&nbsp;"}</div>`;
}).join("");
fs.writeFileSync(outFile, `<!doctype html><meta charset="utf-8"><style>
body{margin:0;background:#1e1e1e;color:#d4d4d4;font:13px/1.35 Menlo,monospace;padding:14px}
.cmd{color:#6fd36f}.note{color:#9cdcfe}div{white-space:pre-wrap;word-break:break-all}
.title{color:#ffcc66;margin-bottom:8px}</style>
<div class="title">t2-02 proof, run ${esc(name)} (rendered from transcript.txt)</div>${body}`);
console.log(lines.length);
