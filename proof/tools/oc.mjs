// usage: node oc.mjs <arm> <tree> <outdir> <step> <obs: none|count|time> -- args...
// Runs the shipped CLI with a clean env. Observer jsonl goes to <outdir>/<step>.obs.jsonl
import { spawnSync, execSync } from "node:child_process";
import fs from "node:fs";
const S = process.env.T101_SCRATCH ?? "<scratch>/scratch";
const T = "<scratch>/tools";
const [arm, tree, outdir, step, obs, , ...args] = process.argv.slice(2);
fs.mkdirSync(outdir, { recursive: true });
const env = { PATH: "<home>/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin", HOME: `${S}/${arm}/home`, OPENCLAW_STATE_DIR: `${S}/${arm}/state`, OPENCLAW_LOG_LEVEL: "trace" };
if (process.env.OC_EXTRA) Object.assign(env, JSON.parse(process.env.OC_EXTRA));
if (obs !== "none") {
  env.NODE_OPTIONS = `--import=file://${T}/observe-search-prepare.mjs`;
  env.T101_OBSERVE_OUT = `${outdir}/${step}.obs.jsonl`;
  if (obs === "time") env.T101_AUTH = "0";
}
const L = `${outdir}/${step}`;
const envStr = Object.entries(env).map(([k, v]) => `${k}=${v}`).join(" ");
fs.writeFileSync(`${L}.cmd`, `env -i ${envStr} node ${tree}/openclaw.mjs ${args.map((a) => JSON.stringify(a)).join(" ")}\n`);
const up = execSync("uptime").toString().trim();
const t0 = process.hrtime.bigint();
const r = spawnSync("node", [`${tree}/openclaw.mjs`, ...args], { env, encoding: "utf8", maxBuffer: 1 << 30 });
const ms = Number(process.hrtime.bigint() - t0) / 1e6;
fs.writeFileSync(`${L}.out`, r.stdout ?? ""); fs.writeFileSync(`${L}.err`, r.stderr ?? "");
fs.writeFileSync(`${L}.exit`, `${r.status}\n`); fs.writeFileSync(`${L}.ms`, ms.toFixed(1) + "\n"); fs.writeFileSync(`${L}.uptime`, up + "\n");
console.log(`${step} exit=${r.status} ms=${ms.toFixed(1)} out=${(r.stdout ?? "").length}B err=${(r.stderr ?? "").length}B`);
