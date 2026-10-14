#!/bin/bash
# Usage: run-tree.sh <label> <repo> <port> <vault-name>
set -uo pipefail
LABEL=$1; REPO=$2; PORT=$3; VAULT=$4
P=$HOME/work/pr-166433-proof
RUN=$P/$LABEL
TOKEN=pr166433-proof-token
QUERY=$5
rm -rf "$RUN"; mkdir -p "$RUN/state"
cp -cR "$P/$VAULT" "$RUN/vault"
cat > "$RUN/openclaw.json" <<JSON
{
  "gateway": { "mode": "local", "port": $PORT, "bind": "loopback", "auth": { "mode": "token", "token": "$TOKEN" } },
  "plugins": { "entries": { "memory-wiki": { "enabled": true, "config": { "vault": { "path": "$RUN/vault" }, "search": { "backend": "local", "corpus": "wiki" }, "ingest": { "autoCompile": false } } } } }
}
JSON
export OPENCLAW_STATE_DIR="$RUN/state" OPENCLAW_CONFIG_PATH="$RUN/openclaw.json"
unset OPENCLAW_GATEWAY_TOKEN OPENCLAW_GATEWAY_URL OPENCLAW_GATEWAY_PORT
echo "tree $LABEL repo $REPO vault $VAULT commit $(git -C "$REPO" rev-parse HEAD) tree $(git -C "$REPO" rev-parse 'HEAD^{tree}') node $(node -v) $(date -u +%FT%TZ)" | tee "$RUN/meta.txt"
uptime | tee -a "$RUN/meta.txt"
(cd "$REPO" && exec node openclaw.mjs gateway run --port "$PORT" --bind loopback > "$RUN/gateway.log" 2>&1) &
GW=$!
node "$HOME/work/pr-166433-scripts/gateway-probe-get.mjs" --port "$PORT" --token "$TOKEN" --query "$QUERY" --label "$LABEL" --out "$RUN/probe.json" 2>&1 | tee "$RUN/probe-summary.txt"
RC=${PIPESTATUS[0]}
ls -a "$RUN/vault" "$RUN/vault/.openclaw-wiki" 2>/dev/null > "$RUN/vault-state.txt"
kill -TERM $GW; for i in $(seq 1 60); do kill -0 $GW 2>/dev/null || break; sleep 1; done; kill -9 $GW 2>/dev/null
echo "probe exit $RC" | tee -a "$RUN/meta.txt"
