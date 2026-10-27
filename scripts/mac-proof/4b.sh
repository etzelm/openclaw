#!/usr/bin/env bash
# FW-4B (#185436): pathPrepend warning on host=node completion paths, with a
# real paired node host (headless `openclaw node run` from the same checkout,
# own state dir, paired to the job-owned Gateway over loopback).
# Review ask: the warning reaching the originating session through (a) a real
# approved detached node command and (b) a delivered node exec.finished event,
# plus unset and per-agent-empty controls.
# The changed code is Gateway-only (bash-tools.exec-host-node.ts,
# server-node-events.ts), so no macOS app is needed; the node host is real.
source "$(dirname "$0")/lib/common.sh"
trap 'pp_node_stop; pp_cleanup' EXIT

SESSION="agent:main:main"
WARN='pathPrepend is ignored for host=node'
MISSING='proof-missing-tool'

pp_node_start() {
  rm -rf "$PP_ROOT/node-state"
  mkdir -p "$PP_ROOT/node-state"
  OPENCLAW_STATE_DIR="$PP_ROOT/node-state" OPENCLAW_CONFIG_PATH="$PP_ROOT/node-state/openclaw.json" \
    OPENCLAW_GATEWAY_TOKEN="$PP_TOKEN" OPENCLAW_NO_BANNER=1 \
    node "$SRC/openclaw.mjs" node run --host 127.0.0.1 --port "$PP_GATEWAY_PORT" \
    --auth-from-env --display-name proof-node >>"$OUT/logs/node-$1.log" 2>&1 &
  echo $! >"$PP_ROOT/node.pid"
  pp_approve_pairing 90
  pp_wait_for 60 "node connected" pp_node_id proof-node
  NODE_ID="$(pp_node_id proof-node)"
  pp_note "[$1] node host connected: $NODE_ID"
  # Every system.run needs an operator approval, so path (a) is a real approval.
  pp_cli approvals set --node "$NODE_ID" --stdin >>"$OUT/logs/approvals.log" 2>&1 <<'EOF' ||
{ version: 1, defaults: { security: "full", ask: "always", askFallback: "deny" } }
EOF
    pp_fail "could not set node approvals"
}

pp_node_stop() {
  [[ -f "$PP_ROOT/node.pid" ]] && kill "$(cat "$PP_ROOT/node.pid")" 2>/dev/null || true
  rm -f "$PP_ROOT/node.pid"
}

session_text() {
  # Everything the originating session received: history plus pending inputs.
  pp_call chat.history "{\"sessionKey\":\"$SESSION\",\"limit\":50}" 2>&1 || true
  pp_tool "{\"tool\":\"sessions_history\",\"args\":{\"sessionKey\":\"$SESSION\",\"includeTools\":true},\"sessionKey\":\"$SESSION\"}" 2>&1 || true
}

run_case() {
  # run_case <label> <config-json> <expect: warn|silent>
  local label="$1" config="$2" expect="$3" body approval_id i
  pp_note "=== case $label (expect $expect)"
  pp_gateway_start "$config"
  pp_node_start "$label"

  # (a) agent exec -> approval pending -> operator approves -> detached follow-up.
  body="$(node -e 'console.log(JSON.stringify({ tool: "exec", sessionKey: process.argv[2],
    args: { command: process.argv[3] + " --version", host: "node", node: process.argv[1] } }))' \
    "$NODE_ID" "$SESSION" "$MISSING")"
  pp_tool "$body" >"$OUT/logs/$label-a-exec-pending.json" 2>&1 || true
  approval_id=""
  for ((i = 0; i < 30 && -z "$approval_id"; i++)); do
    approval_id="$(pp_call exec.approval.list '{}' 2>/dev/null | node -e '
      let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => {
        try { const j = JSON.parse(s); const l = Array.isArray(j) ? j : (j.approvals ?? j.pending ?? j.items ?? []);
          if (l[0]) console.log(l[0].id ?? l[0].approvalId); } catch {}
      });')"
    [[ -n "$approval_id" ]] || sleep 1
  done
  [[ -n "$approval_id" ]] || pp_fail "[$label] no pending exec approval"
  pp_call exec.approval.resolve "{\"id\":\"$approval_id\",\"decision\":\"allow-once\"}" \
    >"$OUT/logs/$label-a-resolve.json" 2>&1 || pp_fail "[$label] approval resolve failed"
  pp_note "[$label] approved $approval_id"
  sleep 10
  session_text >"$OUT/logs/$label-session-after-a.txt"
  pp_note "[$label] path (a) approved follow-up: warning lines = $(grep -c "$WARN" "$OUT/logs/$label-session-after-a.txt" || true)"

  # (b) direct system.run with a session key -> node reports exec.finished.
  pp_call node.invoke "{\"nodeId\":\"$NODE_ID\",\"command\":\"system.run\",\"idempotencyKey\":\"proof-$label-b\",\"sessionKey\":\"$SESSION\",\"params\":{\"command\":[\"/bin/sh\",\"-c\",\"$MISSING --version\"],\"sessionKey\":\"$SESSION\",\"runId\":\"proof-$label-b\",\"approved\":true}}" \
    >"$OUT/logs/$label-b-invoke.json" 2>&1 || true
  sleep 10
  # node.invoke system.run may itself need approval on this node; resolve it too.
  approval_id="$(pp_call exec.approval.list '{}' 2>/dev/null | node -e '
    let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => {
      try { const j = JSON.parse(s); const l = Array.isArray(j) ? j : (j.approvals ?? j.pending ?? []);
        if (l[0]) console.log(l[0].id ?? l[0].approvalId); } catch {}
    });')"
  if [[ -n "$approval_id" ]]; then
    pp_call exec.approval.resolve "{\"id\":\"$approval_id\",\"decision\":\"allow-once\"}" \
      >"$OUT/logs/$label-b-resolve.json" 2>&1 || true
    sleep 10
  fi

  session_text >"$OUT/logs/$label-session.txt"
  grep -n "$WARN" "$OUT/logs/gateway.log" >"$OUT/logs/$label-gateway-warning-lines.txt" || true
  local finished followup
  followup="$(grep -c "Exec finished" "$OUT/logs/$label-session.txt" || true)"
  finished="$(grep -c "$WARN" "$OUT/logs/$label-session.txt" || true)"
  pp_note "[$label] session results mentioning 'Exec finished': $followup; with warning: $finished (after a: see above; the rest is path b)"
  if [[ "$expect" == warn ]]; then
    [[ "$finished" -ge 1 ]] || pp_fail "[$label] warning did not reach the originating session"
  else
    [[ "$finished" -eq 0 ]] || pp_fail "[$label] control leaked the warning"
  fi
  pp_node_stop
  pp_gateway_stop
  mv "$OUT/logs/gateway.log" "$OUT/logs/gateway-$label.log"
}

pp_identity
TOOLS_ALLOW='"gateway": { "tools": { "allow": ["exec"] } }'
run_case configured "{ $TOOLS_ALLOW, \"tools\": { \"exec\": { \"pathPrepend\": [\"/opt/proof-bin\"] } } }" warn
run_case unset "{ $TOOLS_ALLOW }" silent
run_case agent-empty "{ $TOOLS_ALLOW, \"tools\": { \"exec\": { \"pathPrepend\": [\"/opt/proof-bin\"] } },
  \"agents\": { \"list\": [ { \"id\": \"main\", \"default\": true, \"tools\": { \"exec\": { \"pathPrepend\": [] } } } ] } }" silent
pp_note "PASS 4b: warning on configured case, silent on unset and per-agent-empty controls"
