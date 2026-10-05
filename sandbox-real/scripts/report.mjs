// report.mjs: builds sandbox-real tables from out/<case>/ artifacts. Usage: node report.mjs <out-dir>
import fs from "node:fs";
import path from "node:path";
const OUT = process.argv[2];
const MARKER = "PR165112-DEV-SOUL-MARKER";
const parse = (r) => { try { return typeof r.body === "string" ? JSON.parse(r.body) : r.body; } catch { return {}; } };
const rd = (p) => (fs.existsSync(p) ? fs.readFileSync(p, "utf8") : "");

function probes(dir) {
  const rows = rd(path.join(dir, "mock-requests.jsonl")).trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const bodies = rows.map(parse);
  const calls = new Map(); const outs = new Map();
  for (const b of bodies) for (const it of b.input ?? []) {
    if (it.type === "function_call") calls.set(it.call_id, it);
    if (it.type === "function_call_output") outs.set(it.call_id, typeof it.output === "string" ? it.output : JSON.stringify(it.output));
  }
  const first = bodies.find((b) => (b.tools ?? []).length > 0) ?? {};
  const sys = (first.input ?? []).filter((i) => i.role === "system" || i.role === "developer")
    .map((i) => (Array.isArray(i.content) ? i.content.map((c) => c.text ?? "").join("\n") : String(i.content))).join("\n");
  const sysLines = sys.split("\n").filter((l) => /^Working directory:|Agent workspace access|Sandbox container workdir|Sandbox host mount source|^## .*AGENTS\.md/.test(l.trim()) || l.includes("File tools use host workspace"));
  const list = [...calls.entries()].map(([id, c]) => ({ name: c.name, args: JSON.parse(c.arguments), out: outs.get(id) ?? "(no output)" }));
  return { list, sysLines, tools: (first.tools ?? []).map((t) => t.name) };
}
function classify(p) {
  const o = p.out;
  if (/Tool \w+ not found/.test(o)) return "tool not offered";
  if (/container-only/.test(o)) return "DENIED (bridge: container-only path)";
  if (/Sandbox path escapes/.test(o)) return "DENIED (bridge: escapes mounts)";
  if (/File not found|No such file|nonexistent directory/.test(o)) return "not found";
  if (/Read-only file system/.test(o)) return "DENIED (EROFS)";
  if (/Permission denied/.test(o)) return "DENIED (EACCES)";
  if (o.includes(MARKER)) return "READ sibling marker";
  if (/Successfully wrote/.test(o)) return "write reported OK";
  if (/rc=0/.test(o) && p.name === "exec") return "exec rc=0";
  return o.replace(/\s+/g, " ").slice(0, 70);
}
const cases = fs.readdirSync(OUT).filter((d) => /^(pre|post)-/.test(d)).sort((a, b) => {
  const k = (s) => { const [ph, ly, ac] = s.split("-"); return [["pre","post"].indexOf(ph), ["subdir","neither","rootonly"].indexOf(ly), ["none","ro","rw"].indexOf(ac)]; };
  const x = k(a), y = k(b); return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
});
let summary = "| case | access | mounts (host source -> container, mode) | Working directory | sibling dev/SOUL.md reads that returned marker | writes to dev/ reported OK | host sha256 unchanged | probe files on the host under <profile>/workspace | probe files only in the sandbox private copy |\n|---|---|---|---|---|---|---|---|---|\n";
let detail = "";
for (const c of cases) {
  const dir = path.join(OUT, c);
  const { list, sysLines, tools } = probes(dir);
  const mountsFile = fs.readdirSync(dir).find((f) => f.startsWith("docker-mounts."));
  const mounts = mountsFile ? JSON.parse(rd(path.join(dir, mountsFile))) : [];
  const mtxt = mounts.map((m) => `${m.Source.replace(/^<profile>\//, "<profile>/")} -> ${m.Destination} (${m.RW ? "rw" : "ro"})`).join("<br>") || "none";
  const wd = (sysLines.find((l) => l.startsWith("Working directory:")) ?? "?").replace("Working directory: ", "");
  const hv = rd(path.join(dir, "host-verify.txt"));
  const before = hv.match(/sha256_before (\w+)/)?.[1]; const after = hv.match(/sha256_after (\w+)/)?.[1];
  const hostProbeSec = (hv.match(/--- probe files present[^\n]*\n([\s\S]*?)--- sandbox dir/)?.[1] ?? "").split("\n").filter(Boolean);
  const sbxProbe = (hv.match(/--- sandbox dir[^\n]*\n([\s\S]*)$/)?.[1] ?? "").split("\n").filter(Boolean).map((x) => x.replace(/^.*\/state\/sandboxes\/[^\/]+\//, "<sandbox-copy>/"));
  const reads = list.filter((p) => (p.name === "read" || p.name === "exec") && p.out.includes(MARKER) && /dev\/SOUL\.md/.test(JSON.stringify(p.args))).map((p) => `${p.name}:${p.args.path ?? p.args.command.split(";")[0]}`);
  const writes = list.filter((p) => /dev\//.test(JSON.stringify(p.args)) && (p.name === "write" ? /Successfully wrote/.test(p.out) : /rc=0/.test(p.out.split("\n")[0] === "rc=0" ? "rc=0" : p.out)) && (p.name === "write" || /touch|echo .*>>/.test(p.args.command ?? ""))).map((p) => `${p.name}:${p.args.path ?? p.args.command.split(";")[0]}`);
  const [phase, layout, access] = c.split("-");
  summary += `| ${phase} ${layout} | ${access} | ${mtxt} | ${wd} | ${reads.join("<br>") || "none"} | ${writes.join("<br>") || "none"} | ${before === after ? "yes" : "NO"} | ${hostProbeSec.join("<br>") || "none"} | ${sbxProbe.join("<br>") || "none"} |\n`;
  detail += `\n### ${c}\n\n- tools offered to the model: ${tools.join(", ")}\n- provider-visible lines: \n${sysLines.map((l) => "  - `" + l.trim().slice(0, 220) + "`").join("\n")}\n- Doctor: ${phase === "post" ? (rd(path.join(OUT, `doctor-${c}`, "config.diff.txt")).match(/"workspace": "[^"]+"/)?.[0] ?? "no pin written (warning only)") : "not run"}\n- host sha256 before/after: ${before} / ${after}\n\n| # | tool | args | outcome | raw (first 160 chars) |\n|---|---|---|---|---|\n`;
  list.forEach((p, i) => { detail += `| ${i + 1} | ${p.name} | \`${JSON.stringify(p.args).replace(/\|/g, "/").slice(0, 110)}\` | ${classify(p)} | \`${p.out.replace(/\s+/g, " ").replace(/\|/g, "/").replace(/`/g, "'").slice(0, 160)}\` |\n`; });
}
fs.writeFileSync(path.join(OUT, "report-summary.md"), summary);
fs.writeFileSync(path.join(OUT, "report-detail.md"), detail);
console.log(summary);
