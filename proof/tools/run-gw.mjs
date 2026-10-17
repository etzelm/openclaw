// usage: node run-gw.mjs <arm> <count|time> <label> <port>
// Starts a real `gateway run` (detached via setsid by the caller), drives memory.status + 30 memory.search calls, SIGTERMs it.
import { spawn, spawnSync, execSync } from "node:child_process";
import fs from "node:fs";
const P = "<scratch>";
const TOKEN = "<test-token>";
const [arm, variant, label, port] = process.argv.slice(2);
const tree = arm === "before" ? "<home>/work/t1-01-search-prepare-main" : "<home>/work/t1-01-search-prepare";
const S = `${P}/scratch/${arm}`;
const D = `${P}/gateway/${arm}/${label}`;
fs.mkdirSync(`${D}/calls`, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cfgPath = `${S}/state/openclaw.json`;
const before = fs.readFileSync(cfgPath, "utf8");
const after = before.replace(/logging: \{ file: "[^"]*" \}/, `logging: { file: "${D}/openclaw.log" }`);
fs.writeFileSync(`${D}/openclaw.json.before`, before); fs.writeFileSync(cfgPath, after);
fs.writeFileSync(`${D}/config.diff`, `-${before.split("\n").find((l) => l.includes("logging"))}\n+${after.split("\n").find((l) => l.includes("logging"))}\n`);
const env = { PATH: "<home>/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin", HOME: `${S}/home`, OPENCLAW_STATE_DIR: `${S}/state`, OPENCLAW_LOG_LEVEL: "trace",
  NODE_OPTIONS: `--import=file://${P}/tools/observe-search-prepare.mjs`, T101_OBSERVE_OUT: `${D}/gateway.obs.jsonl` };
if (variant === "time") env.T101_AUTH = "0";
const gwArgs = ["gateway", "run", "--port", port, "--bind", "loopback", "--auth", "token", "--token", TOKEN, "--allow-unconfigured"];
fs.writeFileSync(`${D}/gateway.cmd`, `env -i ${Object.entries(env).map(([k, v]) => `${k}=${v}`).join(" ")} node ${tree}/openclaw.mjs ${gwArgs.join(" ")}\n`);
fs.writeFileSync(`${D}/uptime-start.txt`, execSync("uptime").toString());
const outFd = fs.openSync(`${D}/gateway.stdout`, "w");
const child = spawn("node", [`${tree}/openclaw.mjs`, ...gwArgs], { env, stdio: ["ignore", outFd, outFd], detached: true });
let exited = null; child.on("exit", (c, s) => { exited = `code=${c} signal=${s}`; });
const readOut = () => fs.readFileSync(`${D}/gateway.stdout`, "utf8");
const t0 = Date.now();
while (!/http server listening|listening on/.test(readOut())) { if (exited || Date.now() - t0 > 400000) { console.log("gateway failed to start", exited); process.exit(1); } await sleep(500); }
fs.writeFileSync(`${D}/ready-ms.txt`, `${Date.now() - t0}\n`);
await sleep(5000);
const pid = execSync(`lsof -nP -iTCP:${port} -sTCP:LISTEN -t`).toString().trim().split("\n")[0];
fs.writeFileSync(`${D}/gateway.pid`, `spawned=${child.pid} listener=${pid}\n`);
const call = (step, method, params) => {
  const cs = Date.now();
  const r = spawnSync("node", [`${P}/tools/oc.mjs`, arm, tree, `${D}/calls`, step, "none", "--", "gateway", "call", method, "--params", JSON.stringify(params), "--url", `ws://127.0.0.1:${port}`, "--token", TOKEN, "--json"], { encoding: "utf8", env: { ...process.env, T101_SCRATCH: `${P}/scratch` } });
  const ce = Date.now();
  fs.appendFileSync(`${D}/calls.jsonl`, `${JSON.stringify({ step, method, start: cs, end: ce, status: r.status })}\n`);
  return r.status;
};
const Q = ["saffron glacier orchard", "lorem ipsum", "copper willow", "harbor lantern meadow", "cobalt ember tundra"];
call("status", "memory.status", { agentId: "main" });
for (let i = 0; i < 30; i++) {
  const q = Q[i % 5];
  fs.appendFileSync(`${D}/queries.txt`, `s${String(i + 1).padStart(2, "0")} ${i % 5 + 1} ${q}\n`);
  call(`s${String(i + 1).padStart(2, "0")}`, "memory.search", { query: q, agentId: "main", maxResults: 25 });
}
fs.writeFileSync(`${D}/uptime-end.txt`, execSync("uptime").toString());
process.kill(Number(pid), "SIGTERM");
const ts = Date.now();
while (exited === null && Date.now() - ts < 90000) await sleep(300);
fs.writeFileSync(`${D}/gateway.done`, `exit ${exited} after ${Date.now() - ts} ms\n`);
fs.writeFileSync(`${D}/port-free.txt`, (() => { try { return execSync(`lsof -nP -iTCP:${port} -sTCP:LISTEN -t`).toString() || "free\n"; } catch { return "free\n"; } })());
console.log(arm, variant, label, "done", exited);
