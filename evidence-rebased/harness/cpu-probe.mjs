// NODE_OPTIONS preload for observer-off timing runs: wraps nothing. At exit, each process's main
// thread appends its own thread CPU and the process CPU to T203_CPU_OUT (one JSON line per process).
import fs from "node:fs";
import { isMainThread } from "node:worker_threads";
const out = process.env.T203_CPU_OUT;
if (out && isMainThread) {
  process.on("exit", () => {
    const thread = process.threadCpuUsage?.();
    fs.appendFileSync(out, `${JSON.stringify({ pid: process.pid, thread, process: process.cpuUsage() })}\n`);
  });
}
