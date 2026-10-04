// Real /usr/bin/security latency on this host: a not-found lookup against the default search
// list (what every check costs when the login is file-backed), and readable password and
// metadata lookups of a synthetic item in a throwaway keychain.
import { execSync } from "node:child_process";
import os from "node:os";
const run = (label, cmd, n) => {
  const t = [];
  let last = "";
  for (let i = 0; i < n; i++) {
    const s = process.hrtime.bigint();
    try { execSync(cmd, { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], timeout: 2000 }); last = "exit=0"; }
    catch (e) { last = `exit=${e.status}`; }
    t.push(Number(process.hrtime.bigint() - s) / 1e6);
  }
  t.sort((a, b) => a - b);
  const q = (p) => t[Math.min(t.length - 1, Math.floor(p * t.length))].toFixed(2);
  console.log(`${label}: n=${n} ${last} min=${t[0].toFixed(2)}ms p50=${q(0.5)}ms p90=${q(0.9)}ms p99=${q(0.99)}ms max=${t[t.length - 1].toFixed(2)}ms`);
};
console.log(`cpu=${os.cpus()[0].model} cores=${os.cpus().length} loadavg=${os.loadavg().map((l) => l.toFixed(2)).join(" ")}`);
const kc = process.argv[2];
run("not found, default search list, -w", `/usr/bin/security find-generic-password -a "kc-latency-probe" -w -s "Claude Code-credentials-latency-probe"`, 100);
run("readable synthetic item, -w", `/usr/bin/security find-generic-password -a "kc-latency-probe" -w -s "Claude Code-credentials-latency-probe" "${kc}"`, 100);
run("readable synthetic item, metadata", `/usr/bin/security find-generic-password -a "kc-latency-probe" -s "Claude Code-credentials-latency-probe" "${kc}"`, 100);
