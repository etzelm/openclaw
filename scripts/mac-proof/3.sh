#!/usr/bin/env bash
# FW-3 (#185434): live Gateway-to-macOS-app exec with timeoutSeconds 0.
# Review ask: `sleep 45; echo done` completing through a macOS app node with
# timeoutSeconds 0 on the patched build. The base variant runs the same flow
# on the PR base and is expected to end at about 20 s with the TIMEOUT error.
# Gateway, CLI and the app's bundled node-host runtime all come from $SRC.
#
# The exec tool with host=node sends node.invoke system.run with the nested
# timeoutMs it derived from timeoutSeconds (0 here); /tools/invoke does not
# expose exec on the HTTP surface, so this calls node.invoke directly with
# that same wire shape. Path: Gateway normalizer (0 -> null) -> app node ->
# bundled node-host worker (OPENCLAW_NODE_EXEC_HOST=app) -> exec host socket
# (src/infra/exec-host.ts, the patched deadline) -> app ShellExecutor.
source "$(dirname "$0")/lib/common.sh"
trap pp_cleanup EXIT

pp_identity
pp_build_helpers
pp_record_start
# Disposable Gateway; node exec runs without prompts (approvals below) so the
# timing is the only variable.
pp_gateway_start '{}'
pp_app_config
pp_app_launch --dashboard
pp_ax wait-window 90 >/dev/null || pp_fail "app window never appeared"
pp_approve_pairing 120
pp_wait_for 120 "macOS app node connected" pp_node_id "macos|darwin|mac"
NODE_ID="$(pp_node_id "macos|darwin|mac")"
pp_note "app node: $NODE_ID"
pp_cli approvals set --node "$NODE_ID" --stdin >>"$OUT/logs/approvals.log" 2>&1 <<'EOF' ||
{ version: 1, defaults: { security: "full", ask: "off", askFallback: "full" } }
EOF
  pp_fail "could not set node exec approvals"
pp_call node.describe "{\"nodeId\":\"$NODE_ID\"}" >"$OUT/logs/node-describe.json" || true
pp_shot "10-app-connected"

# Gateway invoke deadline 120 s and CLI transport 240 s: both far above the
# 20 s fallback and the 45 s command, so neither can end the call first.
params="$(node -e 'console.log(JSON.stringify({
  nodeId: process.argv[1], command: "system.run", timeoutMs: 120000,
  idempotencyKey: "proof-3-" + process.argv[2],
  params: { command: ["/bin/sh", "-c", "sleep 45; echo done"], timeoutMs: 0, runId: "proof-3-" + process.argv[2] },
}))' "$NODE_ID" "$VARIANT")"
pp_note "exec start: sleep 45; echo done (node.invoke system.run on the app node, timeoutMs 0)"
start="$(date +%s)"
pp_cli gateway call node.invoke --url "ws://127.0.0.1:$PP_GATEWAY_PORT" --token "$PP_TOKEN" \
  --json --timeout 240000 --params "$params" >"$OUT/logs/exec-result.json" 2>&1 || true
elapsed=$(($(date +%s) - start))
pp_note "exec returned after ${elapsed}s"
grep -n "node.invoke\|system.run\|exec host" "$OUT/logs/gateway.log" 2>/dev/null | tail -20 \
  >"$OUT/logs/gateway-exec-lines.log" || true
pp_shot "20-after-exec"

{
  echo "## FW-3 exec through the macOS app node"
  echo
  echo "variant: $VARIANT, source: $(git -C "$SRC" rev-parse --short=12 HEAD)"
  echo "node: $NODE_ID (clientId openclaw-macos, packaged OpenClaw.app)"
  echo "request: node.invoke system.run, params.command sh -c 'sleep 45; echo done', params.timeoutMs 0 (= exec timeoutSeconds 0)"
  echo "elapsed: ${elapsed}s"
  echo
  echo '```json'
  head -c 4000 "$OUT/logs/exec-result.json"
  echo
  echo '```'
} >"$OUT/terminal-transcript.md"

if [[ "$VARIANT" == "head" ]]; then
  # node.invoke may carry the result as payload or as an encoded payloadJSON.
  node -e 'const r = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
    const p = r.payloadJSON ? JSON.parse(r.payloadJSON) : r.payload;
    process.exit(r.ok === true && String(p && p.stdout).trim() === "done" ? 0 : 1);' \
    "$OUT/logs/exec-result.json" ||
    pp_fail "patched build: stdout is not 'done' (elapsed ${elapsed}s)"
  [[ "$elapsed" -ge 45 ]] || pp_fail "patched build returned before the command could finish"
  pp_note "PASS 3 head: done after ${elapsed}s"
else
  if grep -q 'TIMEOUT' "$OUT/logs/exec-result.json" &&
    grep -q 'outcome is unknown' "$OUT/logs/exec-result.json" && [[ "$elapsed" -lt 45 ]]; then
    pp_note "BASE reproduces: TIMEOUT, outcome unknown, after ${elapsed}s"
  else
    pp_note "BASE did not reproduce the TIMEOUT (elapsed ${elapsed}s); see exec-result.json"
  fi
fi
