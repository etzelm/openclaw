// summarize.mjs <case-out-dir>: per-probe tool call + result from the mock request log
import fs from "node:fs";
import path from "node:path";
const dir = process.argv[2];
const rows = fs.readFileSync(path.join(dir, "mock-requests.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
const parse = (r) => { try { return typeof r.body === "string" ? JSON.parse(r.body) : r.body; } catch { return {}; } };
const body = { input: rows.flatMap((r) => parse(r).input ?? []) };
const first = rows.map(parse).find((b) => (b.tools ?? []).length > 0) ?? parse(rows[0]);
const sysText = [first.instructions, ...(first.input ?? []).filter((i) => i.role === "system" || i.role === "developer").map((i) => (Array.isArray(i.content) ? i.content.map((c) => c.text ?? "").join("\n") : String(i.content)))].join("\n");
const wd = sysText.split("\n").filter((l) => !l.includes("<location>") && !l.includes("sessions_list") && /working directory|sandbox|\/agent|workspace access|workspace dir/i.test(l)).slice(0, 25);
console.log("== system prompt lines mentioning working directory / workspace (request 1) ==");
for (const l of wd) console.log("  " + l.slice(0, 300));
const calls = new Map();
const outs = new Map();
for (const it of body.input ?? []) {
  if (it.type === "function_call") calls.set(it.call_id, it);
  if (it.type === "function_call_output") outs.set(it.call_id, it.output);
}
console.log("\n== tools offered ==");
console.log((first.tools ?? []).map((t) => t.name).join(", "));
console.log("\n== probes ==");
let n = 0;
for (const [id, c] of calls) {
  n += 1;
  const o = outs.get(id);
  const text = typeof o === "string" ? o : JSON.stringify(o);
  console.log(`#${n} ${c.name} ${c.arguments}\n    -> ${String(text).replace(/\n/g, "\\n").slice(0, 700)}`);
}
