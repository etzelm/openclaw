#!/usr/bin/env bash
# FW-4B (#185436): pathPrepend warning on host=node completion paths, with a
# real paired node host (headless `openclaw node run` from the same checkout,
# own state dir, paired to the job-owned Gateway over loopback).
# Review ask: the warning reaching the originating session through (a) a real
# approved detached node command and (b) a delivered node exec.finished event,
# plus unset and per-agent-empty controls.
# The changed code is Gateway-only (bash-tools.exec-host-node.ts,
# server-node-events.ts), so no macOS app is needed; the node host is real.
# The agent turn that calls exec runs against a loopback model stub
# (write_stub below, no real model): the stub only asks for the exec call and
# records every request, so its log is exactly what the originating session's
# later turns received. Each path is checked on its own, and every control must
# deliver its completion text without the warning (no vacuous silence).
# Path b: the Gateway hands a node's exec.finished to the session only when the
# invoke caller did not get the result inline (#164511), so a loopback relay
# between node host and Gateway (write_relay) holds that one result frame past
# the invoke deadline.
# VARIANT=base runs the configured case only and expects no warning on either
# path (BASE line); VARIANT=head runs it plus the unset and agent-empty controls.
source "$(dirname "$0")/lib/common.sh"
PP_DONE=0
# bash 3.2 exits 0 from an EXIT trap after a `set -u` abort; the sentinel keeps
# any unfinished scenario red.
trap 'approver_stop; pp_node_stop; relay_stop; pp_stub_stop; gateway_stop_hard || true; pp_cleanup; [[ "$PP_DONE" == 1 ]] || exit 1' EXIT

SESSION="agent:main:main"
WARN='pathPrepend is ignored for host=node'
MISSING='proof-missing-tool'
STUB_PORT="${PP_STUB_PORT:-28791}"
TG_PORT="${PP_TG_PORT:-28792}"
TG_CHAT=4242
RELAY_PORT="${PP_RELAY_PORT:-28793}"
# Path b: the invoke deadline and how long the relay holds the node's result.
INVOKE_TIMEOUT_MS=4000
HOLD_MS=12000

write_stub() {
  cat >"$PP_ROOT/stub-model.mjs" <<'JS'
// Loopback OpenAI-compatible model stub for the 4B proof. It never calls a
// real model. Every chat request body is appended to the request log, so the
// log shows exactly what each agent turn of the originating session received.
// A user message containing PROOF-RUN-EXEC gets one `exec` tool call on the
// node host; every other turn gets a short text reply.
// Usage: node stub-model.mjs <port> <request-log.jsonl> [<telegram-port> <telegram-log.jsonl>]
import { appendFileSync } from "node:fs";
import { createServer } from "node:http";

const port = Number(process.argv[2]);
const logPath = process.argv[3];
const MODEL = "proof-model";
const TRIGGER = "PROOF-RUN-EXEC";
const COMMAND = "proof-missing-tool --version";

const text = (content) =>
  typeof content === "string"
    ? content
    : Array.isArray(content)
      ? content.map((part) => (typeof part === "string" ? part : (part?.text ?? ""))).join("")
      : "";

function decide(messages) {
  // The Gateway appends runtime-context user messages after the prompt, so
  // look at everything since the last assistant turn.
  let lastAssistant = -1;
  messages.forEach((m, i) => {
    if (m?.role === "assistant") lastAssistant = i;
  });
  const turn = messages.slice(lastAssistant + 1);
  const answered = turn.some((m) => m?.role === "tool");
  const asked = turn.some((m) => m?.role === "user" && text(m.content).includes(TRIGGER));
  if (!answered && asked) {
    return { tool: { name: "exec", arguments: JSON.stringify({ command: COMMAND, host: "node" }) } };
  }
  // The detached approval waiter lives as long as the originating turn, so
  // the reply after the approval-pending tool result takes a while, like a
  // real model still writing; the operator approves in the meantime.
  if (answered) return { content: "noted", holdMs: 20000 };
  return { content: "noted" };
}

function send(res, body, reply) {
  const id = `chatcmpl-proof-${Date.now()}`;
  const created = Math.floor(Date.now() / 1000);
  const toolCalls = reply.tool
    ? [{ index: 0, id: `call_${Date.now()}`, type: "function", function: reply.tool }]
    : undefined;
  const finish = reply.tool ? "tool_calls" : "stop";
  const usage = { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 };
  if (!body.stream) {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        id,
        object: "chat.completion",
        created,
        model: MODEL,
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: reply.content ?? null, tool_calls: toolCalls },
            finish_reason: finish,
          },
        ],
        usage,
      }),
    );
    return;
  }
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
  const chunk = (delta, finishReason, extra = {}) =>
    res.write(
      `data: ${JSON.stringify({
        id,
        object: "chat.completion.chunk",
        created,
        model: MODEL,
        choices: [{ index: 0, delta, finish_reason: finishReason }],
        ...extra,
      })}\n\n`,
    );
  chunk(reply.tool ? { role: "assistant", tool_calls: toolCalls } : { role: "assistant", content: reply.content }, null);
  chunk({}, finish, { usage });
  res.write("data: [DONE]\n\n");
  res.end();
}

createServer((req, res) => {
  if (req.method === "GET" && req.url.endsWith("/models")) {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ object: "list", data: [{ id: MODEL, object: "model" }] }));
    return;
  }
  let raw = "";
  req.on("data", (d) => (raw += d));
  req.on("end", () => {
    let body = {};
    try {
      body = JSON.parse(raw || "{}");
    } catch {}
    const messages = Array.isArray(body.messages) ? body.messages : [];
    const reply = decide(messages);
    appendFileSync(
      logPath,
      `${JSON.stringify({ ts: new Date().toISOString(), url: req.url, reply: reply.tool ? "exec-tool-call" : "text", messages })}\n`,
    );
    if (!req.url.endsWith("/chat/completions")) {
      res.writeHead(404).end();
      return;
    }
    setTimeout(() => send(res, body, reply), reply.holdMs ?? 0);
  });
}).listen(port, "127.0.0.1", () => console.log(`stub model on 127.0.0.1:${port}`));

// Fake Telegram Bot API (channels.telegram.apiRoot) so a Telegram-originated
// turn has a real outbound adapter: every call is recorded, sendMessage text
// is what the originating chat would show. Nothing reaches Telegram.
const tgPort = Number(process.argv[4] || 0);
const tgLog = process.argv[5];
if (tgPort) {
  let nextMessageId = 1;
  createServer((req, res) => {
    let raw = "";
    req.on("data", (d) => (raw += d));
    req.on("end", () => {
      const method = (req.url.split("?")[0].split("/").pop() || "").trim();
      let body = {};
      try {
        body = raw.trim().startsWith("{") ? JSON.parse(raw) : Object.fromEntries(new URLSearchParams(raw));
      } catch {}
      appendFileSync(tgLog, `${JSON.stringify({ ts: new Date().toISOString(), method, body })}\n`);
      const reply = (result) => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true, result }));
      };
      const now = Math.floor(Date.now() / 1000);
      if (method === "getMe") {
        return reply({ id: 4200, is_bot: true, first_name: "Proof", username: "proof_bot", can_join_groups: false });
      }
      if (method === "getUpdates") {
        // Long poll: answer empty after a while instead of spinning.
        return setTimeout(() => reply([]), 20000);
      }
      if (method === "sendMessage" || method === "editMessageText") {
        return reply({
          message_id: nextMessageId++,
          date: now,
          chat: { id: Number(body.chat_id) || 4242, type: "private" },
          text: body.text ?? "",
        });
      }
      return reply(true);
    });
  }).listen(tgPort, "127.0.0.1", () => console.log(`fake Telegram Bot API on 127.0.0.1:${tgPort}`));
}
JS
}

pp_stub_start() {
  [[ -f "$PP_ROOT/stub-model.mjs" ]] || write_stub
  node "$PP_ROOT/stub-model.mjs" "$STUB_PORT" "$OUT/logs/$1-model-requests.jsonl" \
    "$TG_PORT" "$OUT/logs/$1-telegram-api.jsonl" \
    >>"$OUT/logs/stub-model.log" 2>&1 &
  echo $! >"$PP_ROOT/stub.pid"
  pp_wait_for 20 "model stub on $STUB_PORT" curl -sf "http://127.0.0.1:$STUB_PORT/v1/models"
}

pp_stub_stop() {
  [[ -f "$PP_ROOT/stub.pid" ]] && kill "$(cat "$PP_ROOT/stub.pid")" 2>/dev/null || true
  rm -f "$PP_ROOT/stub.pid"
}

write_relay() {
  cat >"$PP_ROOT/relay.mjs" <<'JS'
// Loopback WebSocket relay between the node host and the Gateway. Frames pass
// through unchanged, except a node.invoke.result frame containing the hold
// marker, which is forwarded late: the node's result misses the invoke
// deadline after its exec.finished event already arrived, the case where the
// Gateway delivers that event to the session (#164511).
// Usage: node relay.mjs <src> <listen-port> <gateway-port> <hold-marker> <hold-ms> <log>
import { appendFileSync } from "node:fs";
import { createRequire } from "node:module";

const [src, listenPort, gatewayPort, marker, holdMs, logPath] = process.argv.slice(2);
const { WebSocket, WebSocketServer } = createRequire(`${src}/package.json`)("ws");
const log = (entry) => appendFileSync(logPath, `${JSON.stringify({ ts: new Date().toISOString(), ...entry })}\n`);
const server = new WebSocketServer({ host: "127.0.0.1", port: Number(listenPort) });
server.on("connection", (down, req) => {
  const up = new WebSocket(`ws://127.0.0.1:${gatewayPort}${req.url ?? "/"}`);
  const queued = [];
  up.on("open", () => queued.splice(0).forEach(([d, b]) => up.send(d, { binary: b })));
  down.on("message", (data, isBinary) => {
    const text = isBinary ? "" : data.toString();
    const send = () => (up.readyState === WebSocket.OPEN ? up.send(data, { binary: isBinary }) : queued.push([data, isBinary]));
    if (text.includes('"node.invoke.result"') && text.includes(marker)) {
      log({ event: "held-result", holdMs: Number(holdMs) });
      setTimeout(() => {
        log({ event: "released-result" });
        send();
      }, Number(holdMs));
      return;
    }
    send();
  });
  up.on("message", (data, isBinary) => down.readyState === WebSocket.OPEN && down.send(data, { binary: isBinary }));
  const close = () => {
    down.close();
    up.close();
  };
  up.on("close", close);
  down.on("close", close);
  up.on("error", close);
  down.on("error", close);
});
server.on("listening", () => console.log(`relay 127.0.0.1:${listenPort} -> ${gatewayPort}`));
JS
}

relay_start() {
  [[ -f "$PP_ROOT/relay.mjs" ]] || write_relay
  node "$PP_ROOT/relay.mjs" "$SRC" "$RELAY_PORT" "$PP_GATEWAY_PORT" "$MISSING-b" "$HOLD_MS" \
    "$OUT/logs/$1-relay.jsonl" >>"$OUT/logs/relay.log" 2>&1 &
  echo $! >"$PP_ROOT/relay.pid"
  pp_wait_for 20 "relay on $RELAY_PORT" nc -z 127.0.0.1 "$RELAY_PORT"
}

relay_stop() {
  [[ -f "$PP_ROOT/relay.pid" ]] && kill "$(cat "$PP_ROOT/relay.pid")" 2>/dev/null || true
  rm -f "$PP_ROOT/relay.pid"
}

pp_node_start() {
  rm -rf "$PP_ROOT/node-state"
  mkdir -p "$PP_ROOT/node-state"
  OPENCLAW_STATE_DIR="$PP_ROOT/node-state" OPENCLAW_CONFIG_PATH="$PP_ROOT/node-state/openclaw.json" \
    OPENCLAW_GATEWAY_TOKEN="$PP_TOKEN" OPENCLAW_NO_BANNER=1 \
    node "$SRC/openclaw.mjs" node run --host 127.0.0.1 --port "$RELAY_PORT" \
    --auth-from-env --display-name proof-node >>"$OUT/logs/node-$1.log" 2>&1 &
  echo $! >"$PP_ROOT/node.pid"
  node_pair_wait 120
  NODE_ID="$(pp_node_id proof-node)"
  pp_note "[$1] node host connected: $NODE_ID"
  # Every system.run needs an operator approval, so path (a) is a real approval.
  pp_cli approvals set --node "$NODE_ID" --stdin >>"$OUT/logs/approvals.log" 2>&1 <<'EOF' ||
{ version: 1, defaults: { security: "full", ask: "always", askFallback: "deny" } }
EOF
    pp_fail "could not set node approvals"
}

node_pair_wait() {
  # node_pair_wait <seconds>: approve pending pairing requests until the node
  # host shows up connected (loopback pairing is often approved silently, and
  # pp_approve_pairing then waits its full limit).
  local i kind id
  for ((i = 0; i < $1; i += 2)); do
    [[ -n "$(pp_node_id proof-node)" ]] && return 0
    for kind in device node; do
      for id in $(pp_call "$kind.pair.list" '{}' 2>/dev/null | node -e '
        let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => {
          try { for (const p of JSON.parse(s).pending ?? []) console.log(p.requestId); } catch {}
        });'); do
        pp_call "$kind.pair.approve" "{\"requestId\":\"$id\"}" >>"$OUT/logs/pairing.log" 2>&1 &&
          pp_note "approved $kind pairing request $id"
      done
    done
    sleep 2
  done
  pp_fail "node host never connected within $1s"
}

pp_node_stop() {
  [[ -f "$PP_ROOT/node.pid" ]] && kill "$(cat "$PP_ROOT/node.pid")" 2>/dev/null || true
  rm -f "$PP_ROOT/node.pid"
}

gateway_stop_hard() {
  # A Gateway that outlives its CLI wrapper keeps the port, and the next case
  # would talk to the previous case's Gateway. pp_gateway_stop only notes a
  # surviving listener; this returns 1 so the caller can fail the case.
  pp_gateway_stop
  local i pids
  for ((i = 0; i < 20; i++)); do
    pids="$(lsof -ti "tcp:$PP_GATEWAY_PORT" -sTCP:LISTEN 2>/dev/null || true)"
    [[ -z "$pids" ]] && return 0
    # shellcheck disable=SC2086
    kill $pids 2>/dev/null || true
    sleep 1
  done
  return 1
}

write_approver() {
  # Operator client that stays connected like the owner's Control UI: admin and
  # approvals scopes plus the approvals cap make it an approval route, and it resolves every
  # exec approval it is shown with allow-once through exec.approval.resolve.
  cat >"$PP_ROOT/approver.ts" <<'TS'
const [src, url, token, logPath] = process.argv.slice(2);
(async () => {
  const { appendFileSync } = await import("node:fs");
  const { GatewayClient } = await import(`${src}/src/gateway/client.ts`);
  const log = (entry: Record<string, unknown>) =>
    appendFileSync(logPath, `${JSON.stringify({ ts: new Date().toISOString(), ...entry })}\n`);
  const client = new GatewayClient({
    url,
    token,
    // The owner's Control UI holds operator.admin, which makes every approval
    // record visible to it (approval-record-lookup.ts).
    scopes: ["operator.admin", "operator.read", "operator.write", "operator.approvals"],
    caps: ["approvals"],
    clientDisplayName: "proof-approver",
    onHelloOk: (hello: any) => log({ event: "connected", scopes: hello?.auth?.scopes }),
    onConnectError: (err: Error) => log({ event: "connect-error", error: String(err) }),
    onEvent: (evt: { event: string; payload?: any }) => {
      if (evt.event !== "exec.approval.requested") return;
      const id = evt.payload?.id;
      log({ event: "requested", id, command: evt.payload?.request?.command });
      // Approve after a moment, like a person reading the request.
      void new Promise((resolve) => setTimeout(resolve, 3000))
        .then(() => client
        .request("exec.approval.resolve", { id, decision: "allow-once" })
        .then(() => log({ event: "approved", id }))
        .catch((err: unknown) => log({ event: "approve-error", id, error: String(err) })));
    },
  });
  client.start();
})().catch((err) => {
  console.error(String(err));
  process.exit(1);
});
TS
}

approver_start() {
  [[ -f "$PP_ROOT/approver.ts" ]] || write_approver
  (cd "$SRC" && exec "$SRC/node_modules/.bin/tsx" "$PP_ROOT/approver.ts" "$SRC" \
    "ws://127.0.0.1:$PP_GATEWAY_PORT" "$PP_TOKEN" "$OUT/logs/$1-approver.jsonl") \
    >>"$OUT/logs/$1-approver.log" 2>&1 &
  echo $! >"$PP_ROOT/approver.pid"
  pp_wait_for 60 "approver connected" grep -q '"event":"connected"' "$OUT/logs/$1-approver.jsonl"
}

approver_stop() {
  [[ -f "$PP_ROOT/approver.pid" ]] && kill "$(cat "$PP_ROOT/approver.pid")" 2>/dev/null || true
  rm -f "$PP_ROOT/approver.pid"
}

approved_count() {
  [[ -f "$OUT/logs/$1-approver.jsonl" ]] || {
    echo 0
    return
  }
  grep -c '"event":"approved"' "$OUT/logs/$1-approver.jsonl" || true
}

wait_approved() {
  # wait_approved <case> <count> <seconds>
  local i
  for ((i = 0; i < $3; i++)); do
    [[ "$(approved_count "$1")" -ge "$2" ]] && return 0
    sleep 1
  done
  return 1
}

chat_send() {
  # chat_send <label> <message> [extra-params-json]: one user turn in the
  # originating session.
  # Sent like the Control UI does, by an operator client holding the
  # approvals scope: the run's exec approval request inherits the sender's
  # scopes, and `openclaw gateway call` always connects least-privilege.
  # tsx runs from the checkout so its tsconfig paths resolve workspace packages.
  (cd "$SRC" && OPENCLAW_STATE_DIR="$PP_ROOT/gateway-state" \
    OPENCLAW_CONFIG_PATH="$PP_ROOT/gateway-state/openclaw.json" \
    "$SRC/node_modules/.bin/tsx" -e '
    (async () => {
      const [src, url, token, sessionKey, message, key, extra] = process.argv.slice(1);
      const { callGateway } = await import(`${src}/src/gateway/call.ts`);
      const res = await callGateway({
        url, token, method: "chat.send",
        params: { sessionKey, message, idempotencyKey: key, ...JSON.parse(extra || "{}") },
        // Originating route fields need admin, as for a channel ingress.
        scopes: ["operator.admin", "operator.read", "operator.write", "operator.approvals"],
      });
      console.log(JSON.stringify(res));
    })().catch((e) => { console.error(String(e)); process.exit(1); });' \
    "$SRC" "ws://127.0.0.1:$PP_GATEWAY_PORT" "$PP_TOKEN" "$SESSION" "$2" "proof-$1-$(date +%s)" "${3:-}") \
    >>"$OUT/logs/$1-chat-send.json" 2>&1 || pp_fail "[$1] chat.send failed"
}

received() {
  # received <case> <pattern>: model requests (later turns of the originating
  # session) whose messages contain the pattern.
  [[ -f "$OUT/logs/$1-model-requests.jsonl" ]] || {
    echo 0
    return
  }
  grep -cF -- "$2" "$OUT/logs/$1-model-requests.jsonl" || true
}

wait_received() {
  # wait_received <case> <pattern> <seconds>
  local i
  for ((i = 0; i < $3; i++)); do
    [[ "$(received "$1" "$2")" -ge 1 ]] && return 0
    sleep 1
  done
  return 1
}

completion_lines() {
  # completion_lines <case> <marker>: every "Exec finished" text carrying the
  # marker that reached the session, one per line, JSON-unescaped.
  node -e '
    const fs = require("fs");
    const [file, tgFile, marker] = process.argv.slice(1);
    const out = new Set();
    const lines = (f) => (fs.existsSync(f) ? fs.readFileSync(f, "utf8").split("\n").filter(Boolean) : []);
    const texts = [];
    for (const line of lines(file)) {
      for (const m of JSON.parse(line).messages ?? []) {
        texts.push(typeof m.content === "string" ? m.content
          : Array.isArray(m.content) ? m.content.map((p) => p?.text ?? "").join("") : "");
      }
    }
    for (const line of lines(tgFile)) {
      const hit = JSON.parse(line);
      if (hit.method === "sendMessage") texts.push(String(hit.body?.text ?? ""));
    }
    for (const t of texts) {
      {
        let at = t.indexOf("Exec finished");
        while (at >= 0) {
          const next = t.indexOf("Exec finished", at + 1);
          const block = t.slice(at, next < 0 ? undefined : next);
          if (block.includes(marker)) out.add(block.trim().replace(/\n/g, " | "));
          at = next;
        }
      }
    }
    for (const b of out) console.log(b);' "$OUT/logs/$1-model-requests.jsonl" "$OUT/logs/$1-telegram-api.jsonl" "$2"
}

wait_completion() {
  # wait_completion <case> <marker> <seconds>: until a delivered completion
  # carrying the marker shows up.
  local i
  for ((i = 0; i < $3; i++)); do
    [[ -n "$(completion_lines "$1" "$2")" ]] && return 0
    sleep 1
  done
  return 1
}

check_path() {
  # check_path <case> <path> <marker> <expect>
  local text n w
  text="$(completion_lines "$1" "$3")"
  printf '%s\n' "$text" >"$OUT/logs/$1-$2-delivered.txt"
  n="$(grep -c 'Exec finished' <<<"$text" || true)"
  w="$(grep -cF "$WARN" <<<"$text" || true)"
  pp_note "[$1] path $2: delivered completions=$n with warning=$w"
  [[ "$n" -ge 1 ]] || pp_fail "[$1] path $2: completion never reached the originating session"
  if [[ "$4" == warn ]]; then
    [[ "$w" -ge 1 ]] || pp_fail "[$1] path $2: completion reached the session without the warning"
  elif [[ "$4" == missing ]]; then
    [[ "$w" -eq 0 ]] || pp_fail "[$1] path $2: base already carries the warning"
  else
    [[ "$w" -eq 0 ]] || pp_fail "[$1] path $2: control leaked the warning"
  fi
  RESULTS="$RESULTS| $1 | $2 | $n | $w | $4 |"$'\n'
}

run_case() {
  # run_case <label> <config-json> <expect: warn|silent>
  local label="$1" config="$2" expect="$3"
  pp_note "=== case $label (expect $expect)"
  pp_stub_start "$label"
  gateway_stop_hard || pp_fail "Gateway port $PP_GATEWAY_PORT busy before case $label"
  pp_gateway_start "$config"
  relay_start "$label"
  pp_node_start "$label"
  approver_start "$label"

  # (a) agent turn -> exec host=node -> approval pending -> allow-once ->
  # detached follow-up into the originating session.
  # The turn arrives from a chat channel without native exec approvals
  # (Telegram via the loopback fake Bot API, nothing reaches Telegram): the exec
  # tool returns approval-pending, the Control UI-like approver resolves it,
  # and the result comes back as the detached follow-up this PR changed.
  # A webchat turn would keep the approval inline in the same turn instead.
  chat_send "$label-a" "PROOF-RUN-EXEC path a" '{"originatingChannel":"telegram","originatingTo":"'"$TG_CHAT"'"}'

  wait_received "$label" '"reply":"exec-tool-call"' 60 ||
    pp_fail "[$label] agent turn never asked for exec"
  wait_approved "$label" 1 60 || pp_fail "[$label] path a: no exec approval was requested and approved"
  wait_completion "$label" "$MISSING:" 90 ||
    pp_fail "[$label] path a follow-up never reached the originating chat or session"
  pp_note "[$label] path a tool results reporting approval-pending: $(received "$label" 'Exec approval is required')"
  check_path "$label" a "$MISSING:" "$expect"

  # (b) operator node.invoke system.run bound to the session; the node reports
  # exec.finished, its result is held by the relay past the invoke deadline,
  # so the Gateway delivers the exec.finished notice to the session (a caller
  # that got the result inline would drop it).
  pp_cli approvals set --node "$NODE_ID" --stdin >>"$OUT/logs/approvals.log" 2>&1 <<'EOF' ||
{ version: 1, defaults: { security: "full", ask: "off" } }
EOF
    pp_fail "could not relax node approvals for path b"
  pp_call node.invoke "{\"nodeId\":\"$NODE_ID\",\"command\":\"system.run\",\"timeoutMs\":$INVOKE_TIMEOUT_MS,\"idempotencyKey\":\"proof-$label-b\",\"params\":{\"command\":[\"/bin/sh\",\"-c\",\"$MISSING-b --version\"],\"sessionKey\":\"$SESSION\",\"runId\":\"proof-$label-b\"}}" \
    >"$OUT/logs/$label-b-invoke.json" 2>&1 || true
  grep -q '"held-result"' "$OUT/logs/$label-relay.jsonl" 2>/dev/null ||
    pp_fail "[$label] path b: the node result never passed the relay"
  pp_note "[$label] path b: node result held ${HOLD_MS}ms past the ${INVOKE_TIMEOUT_MS}ms invoke deadline"
  wait_completion "$label" "id=proof-$label-b" 60 ||
    pp_fail "[$label] path b exec.finished never reached the originating session"
  check_path "$label" b "id=proof-$label-b" "$expect"

  grep -n "$WARN" "$OUT/logs/gateway.log" >"$OUT/logs/$label-gateway-warning-lines.txt" || true
  pp_call chat.history "{\"sessionKey\":\"$SESSION\",\"limit\":50}" >"$OUT/logs/$label-chat-history.json" 2>&1 || true
  approver_stop
  pp_node_stop
  relay_stop
  gateway_stop_hard || pp_fail "Gateway port $PP_GATEWAY_PORT still in use after stop"
  pp_stub_stop
  mv "$OUT/logs/gateway.log" "$OUT/logs/gateway-$label.log"
}

write_summary() {
  {
    echo "## FW-4B pathPrepend warning on host=node completions, variant $VARIANT"
    echo
    echo "source: $(git -C "$SRC" rev-parse --short=12 HEAD)"
    echo
    echo "| case | path | completions delivered to the session | with warning | expected |"
    echo "|---|---|---|---|---|"
    printf '%s' "$RESULTS"
    echo
    echo "Path a: agent exec host=node, approval allow-once, detached follow-up. Path b: node.invoke system.run, node exec.finished event (node result held past the ${INVOKE_TIMEOUT_MS}ms invoke deadline by a loopback relay)."
    echo "Delivered = text in a later model request of agent:main:main (logs/<case>-model-requests.jsonl, loopback stub, no real model)."
    echo "Exact delivered text: logs/<case>-<path>-delivered.txt."
  } >"$OUT/summary.md"
}

pp_identity
RESULTS=""
TELEGRAM="\"channels\": { \"telegram\": { \"enabled\": true, \"botToken\": \"proof-not-a-token\", \"apiRoot\": \"http://127.0.0.1:$TG_PORT\" } }"
BASE="$TELEGRAM, \"models\": { \"providers\": { \"proof\": { \"baseUrl\": \"http://127.0.0.1:$STUB_PORT/v1\", \"api\": \"openai-completions\", \"auth\": \"none\", \"models\": [ { \"id\": \"proof-model\", \"name\": \"Proof stub\" } ] } } }"
AGENT_DEFAULTS="\"defaults\": { \"model\": { \"primary\": \"proof/proof-model\" } }"
CONFIGURED="{ $BASE, \"agents\": { $AGENT_DEFAULTS }, \"tools\": { \"exec\": { \"host\": \"node\", \"pathPrepend\": [\"/opt/proof-bin\"] } } }"
if [[ "$VARIANT" == base ]]; then
  # PR base: the configured case delivers both completions without the warning.
  run_case configured "$CONFIGURED" missing
  write_summary
  pp_note "BASE 4b: pathPrepend configured, both completions reached the session without the warning"
  PP_DONE=1
  exit 0
fi
run_case configured "$CONFIGURED" warn
[[ "${PP_4B_ONLY_CONFIGURED:-0}" == 1 ]] && pp_fail "PP_4B_ONLY_CONFIGURED set: controls skipped"
run_case unset "{ $BASE, \"agents\": { $AGENT_DEFAULTS }, \"tools\": { \"exec\": { \"host\": \"node\" } } }" silent
run_case agent-empty "{ $BASE, \"tools\": { \"exec\": { \"host\": \"node\", \"pathPrepend\": [\"/opt/proof-bin\"] } },
  \"agents\": { $AGENT_DEFAULTS, \"entries\": { \"main\": { \"tools\": { \"exec\": { \"pathPrepend\": [] } } } } } }" silent

write_summary
pp_note "PASS 4b: warning on both paths in the configured case, delivered without it in unset and per-agent-empty controls"
PP_DONE=1
