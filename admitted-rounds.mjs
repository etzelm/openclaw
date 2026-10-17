// Already-admitted path: CALLS=2 per fresh process; call 2 is the admitted path. 2 warmups + 5 measured per arm, interleaved, 2 rounds.
import { execFileSync } from "node:child_process";
import { loadavg } from "node:os";
const [store, before, after, harness] = process.argv.slice(2);
const db = `${process.env.HOME}/work/t1-02-db/agent-${store}.sqlite`;
const med = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[s.length >> 1]; };
const up = () => execFileSync("uptime").toString().trim();
console.log(`# admitted-path rounds store=${store} node=${process.version} harness=measure-admission.mjs CALLS=2 (call 2 = admitted path)`);
for (let round = 1; round <= 2; round++) {
  console.log(`## round ${round} start: ${up()}`);
  const raw = { before: [], after: [], before_stmt: [], after_stmt: [] };
  for (let i = 0; i < 7; i++) for (const arm of ["before", "after"]) {
    const lines = execFileSync("node", [harness, arm === "before" ? before : after, db, `admitted-${arm}-r${round}-${i}`], { encoding: "utf8", env: { ...process.env, CALLS: "2" } }).trim().split("\n").map((l) => JSON.parse(l));
    const c2 = lines.find((l) => l.phase === "schema.admit" && l.call === 2);
    const counts = lines.find((l) => l.phase === "counts");
    const tag = i < 2 ? "warmup" : "run";
    console.log(`${tag} r${round} ${arm} ${i < 2 ? i + 1 : i - 1}: call2 admit_ms=${c2.admit_ms} reconcile_count_stmt_ms=${c2.reconcile_count_stmt_ms} path=${c2.path} total_changes=${c2.total_changes} ftsAvailable=${c2.ftsAvailable} counts_equal=${counts.counts_equal}`);
    if (i >= 2) { raw[arm].push(c2.admit_ms); raw[`${arm}_stmt`].push(c2.reconcile_count_stmt_ms); }
  }
  for (const arm of ["before", "after"]) console.log(`round ${round} ${arm}: median call2 admit_ms=${med(raw[arm])} raw=[${raw[arm].join(", ")}] | median reconcile_count_stmt_ms=${med(raw[`${arm}_stmt`])} raw=[${raw[`${arm}_stmt`].join(", ")}]`);
  console.log(`## round ${round} end: ${up()}`);
}
console.log("DONE");
