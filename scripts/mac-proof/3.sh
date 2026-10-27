#!/usr/bin/env bash
# FW-3 (#185434): live Gateway-to-macOS-app exec with timeoutSeconds 0.
# Review ask: `sleep 45; echo done` completing through a macOS app node with
# timeoutSeconds 0 on the patched build. The base variant runs the same flow
# on the PR base and is expected to end at about 20 s with the TIMEOUT error.
# Gateway, CLI and the app's bundled node-host runtime all come from $SRC.
source "$(dirname "$0")/lib/common.sh"
trap pp_cleanup EXIT

pp_identity
pp_build_helpers
pp_record_start
# Disposable Gateway: /tools/invoke may call exec (job-owned token only), and
# exec runs without prompts so the timing is the only variable.
pp_gateway_start '{
  "gateway": { "tools": { "allow": ["exec"] } },
  "tools": { "exec": { "security": "full", "ask": "off" } }
}'
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

body="$(node -e 'console.log(JSON.stringify({
  tool: "exec", sessionKey: "agent:main:main",
  args: { command: "sleep 45; echo done", host: "node", node: process.argv[1], timeoutSeconds: 0 },
}))' "$NODE_ID")"
pp_note "exec start: sleep 45; echo done (host=node, timeoutSeconds=0)"
start="$(date +%s)"
PP_TOOL_TIMEOUT=240 pp_tool "$body" >"$OUT/logs/exec-result.json" 2>&1 || true
elapsed=$(($(date +%s) - start))
pp_note "exec returned after ${elapsed}s"
pp_shot "20-after-exec"

{
  echo "## FW-3 exec through the macOS app node"
  echo
  echo "variant: $VARIANT, source: $(git -C "$SRC" rev-parse --short=12 HEAD)"
  echo "command: sleep 45; echo done, host=node, timeoutSeconds=0"
  echo "elapsed: ${elapsed}s"
  echo
  echo '```json'
  head -c 4000 "$OUT/logs/exec-result.json"
  echo
  echo '```'
} >"$OUT/terminal-transcript.md"

if [[ "$VARIANT" == "head" ]]; then
  grep -q 'done' "$OUT/logs/exec-result.json" || pp_fail "patched build: no 'done' in the exec result"
  [[ "$elapsed" -ge 45 ]] || pp_fail "patched build returned before the command could finish"
  pp_note "PASS 3 head: done after ${elapsed}s"
else
  if grep -q 'TIMEOUT' "$OUT/logs/exec-result.json"; then
    pp_note "BASE reproduces: TIMEOUT after ${elapsed}s"
  else
    pp_note "BASE did not reproduce the TIMEOUT (elapsed ${elapsed}s); see exec-result.json"
  fi
fi
