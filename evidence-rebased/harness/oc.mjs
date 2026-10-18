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
  // T203_OBSERVE=0 runs the CLI without the observer preload (timing runs).
  ...(process.env.T203_OBSERVE === "0"
    ? {
        // Timing runs: a CPU probe that wraps nothing (per-process main-thread and process CPU at exit).
        NODE_OPTIONS: `--import=file://${tools}/cpu-probe.mjs`,
        T203_CPU_OUT: `${S}/logs/${step}.cpu.jsonl`,
      }
    : {
        NODE_OPTIONS: `--import=file://${tools}/observe-vector-serialization.mjs`,
        T203_OBSERVE_OUT: `${S}/obs/${step}.jsonl`,
      }),
};
const envStr = Object.entries(env).map(([k, v]) => `${k}=${v}`).join(" ");
const cmd = `env -i ${envStr} node ${clone}/openclaw.mjs ${args.map((a) => JSON.stringify(a)).join(" ")}`;
const t0 = process.hrtime.bigint();
// /usr/bin/time -l records user/sys CPU of the CLI and its reaped child processes (all threads) and peak RSS.
const r = spawnSync("/usr/bin/time", ["-l", "node", `${clone}/openclaw.mjs`, ...args], { env, encoding: "utf8", maxBuffer: 1 << 30 });
const ms = Number(process.hrtime.bigint() - t0) / 1e6;
fs.writeFileSync(`${S}/logs/${step}.cmd`, `${cmd}\n`);
fs.writeFileSync(`${S}/logs/${step}.out`, r.stdout ?? "");
fs.writeFileSync(`${S}/logs/${step}.err`, r.stderr ?? "");
fs.writeFileSync(`${S}/logs/${step}.exit`, `${r.status}\n`);
fs.writeFileSync(`${S}/logs/${step}.ms`, `${ms.toFixed(1)}\n`);
const rus = /([\d.]+) real\s+([\d.]+) user\s+([\d.]+) sys[\s\S]*?(\d+)\s+maximum resident set size/.exec(r.stderr ?? "");
if (rus) fs.writeFileSync(`${S}/logs/${step}.rusage`, `${JSON.stringify({ real: +rus[1], user: +rus[2], sys: +rus[3], maxRssBytes: +rus[4] })}\n`);
console.log(`${step} exit=${r.status} ms=${ms.toFixed(1)}`);
process.exit(r.status === 0 ? 0 : 1);
