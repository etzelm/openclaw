#!/usr/bin/env node
// usage: node paired.mjs <run-root> [arm-a=base] [arm-b=after]
// Per cell and round: median wall, CPU (user+sys, CLI process tree) and host main-thread CPU (cpu probe),
// the 1-minute load range at run start, and the paired difference (B minus A) of runs with the same tag.
// Median of an even count = mean of the two middle values.
import fs from "node:fs";
const [R, A = "base", B = "after"] = process.argv.slice(2);
const rd = (p) => { try { return fs.readFileSync(p, "utf8"); } catch { return null; } };
const num = (p) => { const v = rd(p); return v == null || v.trim() === "" ? NaN : Number(v); };
const med = (xs) => { const s = xs.filter(Number.isFinite).sort((a, b) => a - b); const n = s.length; return !n ? NaN : n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2; };
const f = (n, d = 1) => (Number.isFinite(n) ? n.toFixed(d) : "n/a");
const run = (d) => {
  const ru = (() => { try { return JSON.parse(rd(`${R}/${d}/logs/a-index.rusage`)); } catch { return null; } })();
  const probe = (rd(`${R}/${d}/logs/a-index.cpu.jsonl`) ?? "").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const w = probe.toSorted((x, y) => y.process.user + y.process.system - x.process.user - x.process.system)[0];
  const load = Number(/load averages: ([\d.]+)/.exec(rd(`${R}/${d}/transcript.txt`) ?? "")?.[1]);
  return { wall: num(`${R}/${d}/logs/a-index.ms`) / 1000, exit: num(`${R}/${d}/logs/a-index.exit`), cpu: ru ? ru.user + ru.sys : NaN, host: w?.thread ? (w.thread.user + w.thread.system) / 1e6 : NaN, load };
};
const dirs = fs.readdirSync(R).filter((d) => fs.existsSync(`${R}/${d}/logs`));
const cells = [...new Set(dirs.map((d) => d.split("-").slice(1, 3).join("-")))].sort();
for (const cell of cells) for (const round of [1, 2]) {
  const tags = [...new Set(dirs.filter((d) => d.includes(`-${cell}-r${round}-`) && !d.endsWith("warm")).map((d) => d.slice(d.indexOf(`r${round}-`))))].sort();
  if (!tags.length) continue;
  const get = (arm) => tags.map((t) => run(`${arm}-${cell}-${t}`)).filter((r) => r.exit === 0);
  const a = get(A), b = get(B);
  const loads = [...a, ...b].map((r) => r.load);
  console.log(`${cell} round ${round}: n=${a.length}/${b.length}, load1 at start ${f(Math.min(...loads))} to ${f(Math.max(...loads))}`);
  for (const [k, label] of [["wall", "wall s"], ["cpu", "CPU s (process tree)"], ["host", "host main-thread CPU s"]]) {
    const pairs = tags.map((t) => run(`${B}-${cell}-${t}`)[k] - run(`${A}-${cell}-${t}`)[k]);
    console.log(`  ${label}: ${A} median ${f(med(a.map((r) => r[k])))}, ${B} median ${f(med(b.map((r) => r[k])))}; paired ${B} minus ${A} by tag: ${pairs.map((p) => f(p)).join(", ")} (median ${f(med(pairs))})`);
  }
}
