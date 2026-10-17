// Orchestrate BEFORE/AFTER admission measurements, one fresh `node measure-admission.mjs` process each.
// Usage: node measure-rounds.mjs <warm|cold> <store: dev|main> <before-tree> <after-tree> <evidence-dir>
// Warm: per round, 2 warmup processes per arm then 5 measured per arm, interleaved B A B A.
// Cold: per round, 5 measured per arm interleaved; each on its own fresh F_NOCACHE copy, deleted after the run.
// Waits (up to 30 min) for the 1-minute load average < 8 before each round, records uptime at round start/end.
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, rmSync, statSync, writeFileSync } from "node:fs";
import { loadavg, homedir } from "node:os";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const [mode, store, beforeTree, afterTree, evDir] = process.argv.slice(2);
const here = dirname(fileURLToPath(import.meta.url));
const db = `${homedir()}/work/t1-02-db/agent-${store}.sqlite`;
const coldCopy = `${homedir()}/work/t1-02-db/cold-${store}.sqlite`;
const outFile = `${evDir}/measure-admission-${store}-${mode}.out`;
const jsonFile = `${evDir}/measure-admission-${store}-${mode}.json`;
const ROUNDS = 2, WARMUPS = 2, RUNS = 5;
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const say = (s) => { console.log(s); appendFileSync(outFile, s + "\n"); };
const uptime = () => execFileSync("uptime").toString().trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
writeFileSync(outFile, "");

async function waitForLoad() {
  const start = Date.now();
  while (loadavg()[0] >= 8 && Date.now() - start < 30 * 60_000) await sleep(60_000);
  const ok = loadavg()[0] < 8;
  say(`load gate: ${ok ? "passed" : "NOT reached after 30 min, running anyway"}; waited ${Math.round((Date.now() - start) / 1000)} s; load1=${loadavg()[0].toFixed(2)}`);
}
function one(arm, label) {
  if (mode === "cold") {
    for (const f of [coldCopy, `${coldCopy}-wal`, `${coldCopy}-shm`]) rmSync(f, { force: true });
    execFileSync("python3", ["-I", `${here}/cold-copy.py`, db, coldCopy]);
  }
  const target = mode === "cold" ? coldCopy : db;
  const tree = arm === "before" ? beforeTree : afterTree;
  let lines;
  try {
    lines = execFileSync("node", [`${here}/measure-admission.mjs`, tree, target, label], { encoding: "utf8", env: { ...process.env, CALLS: "1" }, maxBuffer: 1 << 20 })
      .trim().split("\n").map((l) => JSON.parse(l));
  } finally {
    if (mode === "cold") for (const f of [coldCopy, `${coldCopy}-wal`, `${coldCopy}-shm`]) rmSync(f, { force: true });
  }
  const admit = lines.find((l) => l.phase === "schema.admit");
  const counts = lines.find((l) => l.phase === "counts");
  return { admit, counts };
}

const results = { mode, store, rounds: [] };
say(`# measure-admission ${mode} store=${store} node=${process.version} store_bytes=${statSync(db).size}`);
say(`# before=${beforeTree} after=${afterTree}`);
let meta;
for (let round = 1; round <= ROUNDS; round++) {
  await waitForLoad();
  say(`## round ${round} start: ${uptime()}`);
  const arms = ["before", "after"];
  const raw = { before: [], after: [] };
  if (mode === "warm") {
    for (let i = 1; i <= WARMUPS; i++) for (const arm of arms) {
      const r = one(arm, `warmup-${arm}-r${round}-${i}`);
      say(`warmup r${round} ${arm} ${i}: admit_ms=${r.admit.admit_ms} path=${r.admit.path} total_changes=${r.admit.total_changes}`);
    }
  }
  for (let i = 1; i <= RUNS; i++) for (const arm of arms) {
    const r = one(arm, `${mode}-${arm}-r${round}-${i}`);
    meta ??= r.counts;
    raw[arm].push({ admit_ms: r.admit.admit_ms, stmt_ms: r.admit.reconcile_count_stmt_ms, path: r.admit.path, total_changes: r.admit.total_changes, ftsAvailable: r.admit.ftsAvailable, counts_equal: r.counts.counts_equal, canonical: r.counts.canonical_count, fts: r.counts.fts_count, docsize: r.counts.docsize_count });
    say(`${mode} r${round} ${arm} ${i}: admit_ms=${r.admit.admit_ms} reconcile_count_stmt_ms=${r.admit.reconcile_count_stmt_ms} path=${r.admit.path} total_changes=${r.admit.total_changes} ftsAvailable=${r.admit.ftsAvailable} counts_equal=${r.counts.counts_equal}`);
  }
  const summ = {};
  for (const arm of arms) {
    const a = raw[arm].map((x) => x.admit_ms), s = raw[arm].map((x) => x.stmt_ms);
    summ[arm] = { admit_ms_raw: a, admit_ms_median: median(a), stmt_ms_raw: s, stmt_ms_median: median(s), paths: [...new Set(raw[arm].map((x) => x.path))], total_changes: [...new Set(raw[arm].map((x) => x.total_changes))], counts_equal: raw[arm].every((x) => x.counts_equal), canonical: raw[arm][0].canonical, fts: raw[arm][0].fts, docsize: raw[arm][0].docsize };
    say(`round ${round} ${arm}: median admit_ms=${summ[arm].admit_ms_median} raw=[${a.join(", ")}] | median reconcile_count_stmt_ms=${summ[arm].stmt_ms_median} raw=[${s.join(", ")}]`);
  }
  say(`## round ${round} end: ${uptime()}`);
  results.rounds.push(summ);
}
results.sqlite = meta.sqlite; results.node = meta.node; results.store_bytes = statSync(db).size;
writeFileSync(jsonFile, JSON.stringify(results, null, 1));
say("DONE");
