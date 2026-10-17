// usage: node oc-gw.mjs <S> <step> <clone> <extraEnvJSON> -- args...  (observer to obs-gw${process.env.GWSFX ?? ""}/cli.jsonl; out under logs-gw/<step>.*)
import { spawnSync } from "node:child_process";
import fs from "node:fs";
const [S, step, clone, extra, , ...args] = process.argv.slice(2);
const T = "<scratch>/tools";
fs.mkdirSync(`${S}/logs-gw${process.env.GWSFX ?? ""}`, { recursive: true }); fs.mkdirSync(`${S}/obs-gw${process.env.GWSFX ?? ""}`, { recursive: true });
const env = { PATH: process.env.PATH, HOME: `${S}/home`, OPENCLAW_STATE_DIR: `${S}/state-gw`, OPENCLAW_LOG_LEVEL: "trace",
  NODE_OPTIONS: `--import=file://${T}/observe-reconcile-count.mjs`, T102_OBSERVE_OUT: `${S}/obs-gw${process.env.GWSFX ?? ""}/cli.jsonl`, ...JSON.parse(extra) };
const envStr = Object.entries(env).map(([k, v]) => `${k}=${v}`).join(" ");
const cmd = `env -i ${envStr} node ${clone}/openclaw.mjs ${args.map((a) => JSON.stringify(a)).join(" ")}`;
const t0 = process.hrtime.bigint();
const r = spawnSync("node", [`${clone}/openclaw.mjs`, ...args], { env, encoding: "utf8", maxBuffer: 1 << 30 });
const ms = Number(process.hrtime.bigint() - t0) / 1e6;
const L = `${S}/logs-gw${process.env.GWSFX ?? ""}/${step}`;
fs.writeFileSync(`${L}.cmd`, cmd + "\n"); fs.writeFileSync(`${L}.out`, r.stdout ?? ""); fs.writeFileSync(`${L}.err`, r.stderr ?? "");
fs.writeFileSync(`${L}.exit`, `${r.status}\n`); fs.writeFileSync(`${L}.ms`, ms.toFixed(1) + "\n"); fs.writeFileSync(`${L}.pid`, `${r.pid}\n`);
console.log(`${step} pid=${r.pid} exit=${r.status} ms=${ms.toFixed(1)} out=${(r.stdout ?? "").length}B err=${(r.stderr ?? "").length}B`);
