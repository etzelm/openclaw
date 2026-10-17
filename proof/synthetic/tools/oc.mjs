// usage: node oc.mjs <S> <stateName> <step> <observe:0|1> <clone> -- args...
import { spawnSync } from "node:child_process";
import fs from "node:fs";
const [S, stateName, step, observe, clone, , ...args] = process.argv.slice(2);
const T = "<scratch>/tools";
fs.mkdirSync(`${S}/logs`, { recursive: true });
fs.mkdirSync(`${S}/obs`, { recursive: true });
const env = { PATH: process.env.PATH, HOME: `${S}/home`, OPENCLAW_STATE_DIR: `${S}/${stateName}`, OPENCLAW_LOG_LEVEL: "trace" };
if (observe === "1") {
  env.NODE_OPTIONS = `--import=file://${T}/${process.env.OC_DEEP ? "observe-deep.mjs" : "observe-reconcile-count.mjs"}`;
  env.T102_OBSERVE_OUT = `${S}/obs/${step}.jsonl`;
}
const envStr = Object.entries(env).map(([k, v]) => `${k}=${v}`).join(" ");
const cmd = `env -i ${envStr} node ${clone}/openclaw.mjs ${args.map((a) => JSON.stringify(a)).join(" ")}`;
const t0 = process.hrtime.bigint();
const r = spawnSync("node", [`${clone}/openclaw.mjs`, ...args], { env, encoding: "utf8", maxBuffer: 1 << 30 });
const ms = Number(process.hrtime.bigint() - t0) / 1e6;
fs.writeFileSync(`${S}/logs/${step}.cmd`, cmd + "\n");
fs.writeFileSync(`${S}/logs/${step}.out`, r.stdout ?? "");
fs.writeFileSync(`${S}/logs/${step}.err`, r.stderr ?? "");
fs.writeFileSync(`${S}/logs/${step}.exit`, `${r.status}\n`);
fs.writeFileSync(`${S}/logs/${step}.ms`, ms.toFixed(1) + "\n");
console.log(`${step} exit=${r.status} ms=${ms.toFixed(1)} out=${(r.stdout ?? "").length}B err=${(r.stderr ?? "").length}B`);
