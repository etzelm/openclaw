#!/usr/bin/env node
// Runs one shipped CLI command of one arm in a clean environment and keeps its full output.
// usage: node oc.mjs <run-dir> <step> <clone> -- <openclaw args...>
// Writes <run-dir>/logs/<step>.{cmd,out,err,exit,ms}; the observer writes <run-dir>/obs/<step>.jsonl.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const [S, step, clone, , ...args] = process.argv.slice(2);
const tools = path.dirname(new URL(import.meta.url).pathname);
fs.mkdirSync(`${S}/logs`, { recursive: true });
fs.mkdirSync(`${S}/obs`, { recursive: true });
const env = {
  PATH: process.env.PATH,
  HOME: `${S}/home`,
  OPENCLAW_STATE_DIR: `${S}/state`,
  NODE_OPTIONS: `--import=file://${tools}/observe-memory-writes.mjs`,
  T202_OBSERVE_OUT: `${S}/obs/${step}.jsonl`,
};
const envStr = Object.entries(env).map(([k, v]) => `${k}=${v}`).join(" ");
const cmd = `env -i ${envStr} node ${clone}/openclaw.mjs ${args.map((a) => JSON.stringify(a)).join(" ")}`;
const t0 = process.hrtime.bigint();
const r = spawnSync("node", [`${clone}/openclaw.mjs`, ...args], { env, encoding: "utf8", maxBuffer: 1 << 30 });
const ms = Number(process.hrtime.bigint() - t0) / 1e6;
fs.writeFileSync(`${S}/logs/${step}.cmd`, `${cmd}\n`);
fs.writeFileSync(`${S}/logs/${step}.out`, r.stdout ?? "");
fs.writeFileSync(`${S}/logs/${step}.err`, r.stderr ?? "");
fs.writeFileSync(`${S}/logs/${step}.exit`, `${r.status}\n`);
fs.writeFileSync(`${S}/logs/${step}.ms`, `${ms.toFixed(1)}\n`);
console.log(`${step} exit=${r.status} ms=${ms.toFixed(1)}`);
process.exit(r.status === 0 ? 0 : 1);
