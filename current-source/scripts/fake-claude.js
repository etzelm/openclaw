#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const { createInterface } = require("node:readline");
const dir = process.env.FAKE_CLAUDE_DIR;
const argv = process.argv.slice(2);
if (argv.includes("--version")) { process.stdout.write("2.1.300 (Claude Code)\n"); process.exit(0); }
if (argv[0] === "auth" && argv[1] === "status") {
  process.stdout.write(JSON.stringify({ loggedIn: true, authMethod: "claude.ai", email: "qa@example.com" }) + "\n");
  process.exit(0);
}
const send = (value) => process.stdout.write(JSON.stringify(value) + "\n");
const sessionIdx = argv.indexOf("--session-id");
const sessionId = sessionIdx >= 0 ? argv[sessionIdx + 1] : require("node:crypto").randomUUID();
let turnStarted = false;
let resultEmitted = false;
for (const sig of ["SIGTERM", "SIGINT", "SIGHUP"]) {
  process.on(sig, () => { if (resultEmitted) process.exit(0); });
}
process.stdin.on("end", () => { if (resultEmitted) process.exit(0); });
setInterval(() => {}, 60_000);
const rl = createInterface({ input: process.stdin });
rl.on("line", (line) => {
  let message;
  try { message = JSON.parse(line); } catch { return; }
  if (message.type === "control_request" && message.request && message.request.subtype === "initialize") {
    send({ type: "control_response", response: { subtype: "success", request_id: message.request_id, response: { commands: [], models: [] } } });
    return;
  }
  if (message.type === "control_request") {
    send({ type: "control_response", response: { subtype: "success", request_id: message.request_id, response: {} } });
    return;
  }
  if (message.type === "control_cancel_request") return;
  if (message.type === "user" && !turnStarted) {
    turnStarted = true;
    const startedAt = Date.now();
    fs.writeFileSync(path.join(dir, "turn-started.json"), JSON.stringify({ pid: process.pid, at: startedAt }));
    send({ type: "system", subtype: "init", session_id: sessionId, model: "claude-opus-5", tools: [], cwd: process.cwd() });
    const release = () => {
      if (resultEmitted || !fs.existsSync(path.join(dir, "turn-release"))) return;
      watcher.close();
      const text = "fake-claude reply " + sessionId;
      send({ type: "assistant", message: { id: "msg_1", role: "assistant", model: "claude-opus-5", content: [{ type: "text", text }] }, session_id: sessionId });
      send({ type: "result", subtype: "success", is_error: false, result: text, session_id: sessionId, duration_ms: Date.now() - startedAt, num_turns: 1, usage: { input_tokens: 10, output_tokens: 5 } });
      resultEmitted = true;
      fs.writeFileSync(path.join(dir, "turn-finished.json"), JSON.stringify({ pid: process.pid, at: Date.now() }));
    };
    const watcher = fs.watch(dir, release);
    release();
    return;
  }
});
