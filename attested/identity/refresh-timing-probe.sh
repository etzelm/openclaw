#!/bin/bash
# Real Claude CLI against a synthetic login in a scratch config dir. Every outbound HTTPS
# connection goes to a local CONNECT proxy that logs host and time and refuses it, so no
# request reaches Anthropic and no real credential is read or changed.
# usage: refresh-timing-probe.sh <expired|valid>
set -u
export PATH=/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin
MODE=$1
S=/private/tmp/oc164796c-probe-$MODE
rm -rf "$S"; mkdir -p "$S/home" "$S/cfg"
NOW=$(node -e 'console.log(Date.now())')
if [ "$MODE" = expired ]; then EXP=$((NOW-3600000)); else EXP=$((NOW+7200000)); fi
printf '{"claudeAiOauth":{"accessToken":"sk-ant-oat01-synthetic-probe","refreshToken":"sk-ant-ort01-synthetic-probe","expiresAt":%s,"scopes":["user:inference","user:profile","user:sessions:claude_code"],"subscriptionType":"max"}}' "$EXP" > "$S/cfg/.credentials.json"
printf '{"hasCompletedOnboarding":true,"oauthAccount":{"accountUuid":"00000000-0000-4000-8000-000000000001","emailAddress":"probe@example.invalid","organizationUuid":"00000000-0000-4000-8000-000000000002"}}' > "$S/cfg/.claude.json"
cat > "$S/proxy.mjs" <<'JS'
import net from "node:net";
const t0 = Number(process.env.T0);
const srv = net.createServer((sock) => {
  sock.once("data", (buf) => {
    const line = buf.toString("latin1").split("\r\n")[0];
    console.log(JSON.stringify({ ms: Date.now() - t0, proxy: line }));
    sock.end("HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n");
  });
  sock.on("error", () => {});
});
srv.listen(Number(process.env.PORT), "127.0.0.1");
setTimeout(() => process.exit(0), 40000);
JS
cat > "$S/drive.mjs" <<'JS'
import { spawn } from "node:child_process";
const t0 = Number(process.env.T0);
const log = (o) => console.log(JSON.stringify({ ms: Date.now() - t0, ...o }));
const child = spawn(process.env.CLAUDE_BIN, ["-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose", "--model", "haiku"], { stdio: ["pipe", "pipe", "pipe"], env: process.env });
log({ event: "spawn" });
let buf = ""; let sent = false;
child.stdout.on("data", (d) => {
  buf += d; let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i); buf = buf.slice(i + 1);
    let rec; try { rec = JSON.parse(line); } catch { log({ stdout: line.slice(0, 120) }); continue; }
    log({ stdout: rec.type, subtype: rec.subtype ?? rec.response?.subtype });
    if (!sent && rec.type === "control_response") {
      sent = true; log({ event: "send-user" });
      child.stdin.write(JSON.stringify({ type: "user", message: { role: "user", content: "Reply with ok." }, parent_tool_use_id: null }) + "\n");
    }
  }
});
child.stderr.on("data", (d) => log({ stderr: String(d).slice(0, 200) }));
child.on("exit", (code) => { log({ event: "exit", code }); process.exit(0); });
child.stdin.write(JSON.stringify({ type: "control_request", request_id: "init-1", request: { subtype: "initialize" } }) + "\n");
log({ event: "send-initialize" });
setTimeout(() => { log({ event: "timeout-kill" }); child.kill(); }, 30000);
JS
PORT=$((20000 + RANDOM % 20000))
export T0=$NOW PORT
node "$S/proxy.mjs" > "$S/proxy.log" 2>&1 &
PP=$!
sleep 0.3
env -i PATH="$PATH" HOME="$S/home" USER="$USER" CLAUDE_CONFIG_DIR="$S/cfg" HTTPS_PROXY="http://127.0.0.1:$PORT" HTTP_PROXY="http://127.0.0.1:$PORT" T0=$NOW CLAUDE_BIN=$HOME/.local/bin/claude node "$S/drive.mjs" > "$S/drive.log" 2>&1
kill $PP 2>/dev/null; wait $PP 2>/dev/null
echo "== mode=$MODE expiresAt-now=$((EXP-NOW))ms"
sort -t: -k2 -n "$S/drive.log" "$S/proxy.log" | node -e 'const l=require("fs").readFileSync(0,"utf8").trim().split("\n").map(x=>{try{return JSON.parse(x)}catch{return {raw:x}}}).sort((a,b)=>(a.ms??0)-(b.ms??0));for(const r of l)console.log(JSON.stringify(r))'
rm -rf "$S"
