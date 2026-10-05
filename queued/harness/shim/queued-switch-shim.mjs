// Preloaded into the openclaw process (NODE_OPTIONS=--import). Models a login change while a
// SQLite worker command is queued: right after the host posts a command of type
// QUEUED_SWITCH_COMMAND to the worker (the Nth such command, QUEUED_SWITCH_NTH, default 1) it
// runs QUEUED_SWITCH_SCRIPT synchronously, before the worker can open its transaction and
// before the host services the worker's admission request. Every worker command type seen is
// logged to QUEUED_SWITCH_LOG. Production code is unchanged.
import { execSync } from "node:child_process";
import fs from "node:fs";
import { deserialize } from "node:v8";
import { Worker } from "node:worker_threads";

const wanted = process.env.QUEUED_SWITCH_COMMAND;
const script = process.env.QUEUED_SWITCH_SCRIPT;
const log = process.env.QUEUED_SWITCH_LOG;
const nth = Number(process.env.QUEUED_SWITCH_NTH ?? "1");
const note = (event) => {
  if (log) {
    fs.appendFileSync(log, JSON.stringify({ at: new Date().toISOString(), pid: process.pid, ...event }) + "\n");
  }
};
const post = Worker.prototype.postMessage;
let seen = 0;
Worker.prototype.postMessage = function (...args) {
  const result = post.apply(this, args);
  const request = args[0];
  if (request?.type === "execute" && request.input instanceof Uint8Array) {
    let type;
    try {
      const command = deserialize(request.input);
      type = (command.input?.command ?? command).type;
    } catch {}
    if (type && log) {
      note({ event: "worker-command-queued", type });
    }
    if (wanted && script && type === wanted && ++seen === nth) {
      execSync(script, { stdio: "ignore" });
      note({ event: "login-switched-while-queued", type, nth });
    }
  }
  return result;
};
