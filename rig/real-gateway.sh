#!/bin/zsh
# Real Gateway keepalive proof: shipped GatewayChannelActor (base, then head) against a real
# `openclaw gateway run` on loopback built from the same base checkout. Logs redacted at the end.
# Usage: rig/real-gateway.sh <openclaw checkout at BASE, after pnpm install, prepare-apple-mermaid and pnpm build>
S="$(cd "$(dirname "$0")" && pwd)"
W="${RUNNER_TEMP:-/tmp}/keepalive-miss-real"; E=$W/out/real-gateway; mkdir -p $E
R="$1"
BASE=cb73e59f9356796d4eec6ffeffff327e213355a6
K=$R/apps/shared/OpenClawKit
PORT=19431
GS=$W/gw-state
TOKEN=$(openssl rand -hex 24)
step() { echo "$(date -u +%H:%M:%S) $*" >> $E/steps.log; }
{ git -C $R rev-parse HEAD; xcode-select -p; xcodebuild -version; swift --version 2>&1; sw_vers; node --version; sysctl -n hw.ncpu; } > $E/environment.txt 2>&1

mkdir -p $GS
cat > $GS/openclaw.json <<JSON
{ "gateway": { "mode": "local", "bind": "loopback", "port": $PORT, "auth": { "mode": "token" } } }
JSON
export OPENCLAW_STATE_DIR=$GS OPENCLAW_CONFIG_PATH=$GS/openclaw.json OPENCLAW_GATEWAY_TOKEN=$TOKEN
export OPENCLAW_DISABLE_BONJOUR=1 OPENCLAW_SKIP_CHANNELS=1 OPENCLAW_NO_RESPAWN=1 OPENCLAW_ALLOW_MULTI_GATEWAY=1 OPENCLAW_EXEC_SHELL_SNAPSHOT=0
step gateway-start
(cd $R && node openclaw.mjs gateway run --port $PORT > $E/gateway.log 2>&1) &
GWWRAP=$!
for i in {1..300}; do
  GWPID=$(lsof -nP -t -iTCP:$PORT -sTCP:LISTEN 2>/dev/null | head -1)
  [ -n "$GWPID" ] && break
  sleep 2
done
[ -z "$GWPID" ] && { step GATEWAY_NOT_LISTENING; kill $GWWRAP 2>/dev/null; exit 1; }
step "gateway listening pid=$GWPID"
ps -o pid,command -p $GWPID | sed "s#$HOME#~#g" >> $E/environment.txt


# Hosted runners allow sudo, so the shipped client's os_log lines can be captured there.
sudo -n /usr/bin/log stream --style compact --predicate 'subsystem == "ai.openclaw" AND category == "gateway"' > $E/client-os-log.log 2>&1 &
LOGPID=$!
export KEEPALIVE_GATEWAY_URL=ws://127.0.0.1:$PORT KEEPALIVE_GATEWAY_TOKEN=$TOKEN KEEPALIVE_GATEWAY_PID=$GWPID
for side in base head; do
  git -C $R reset -q --hard
  [ $side = head ] && git -C $R apply --index $S/head.diff
  git -C $R apply --index $S/real-gateway.diff
  echo "$side tree $(git -C $R write-tree)" >> $E/environment.txt
  kill -CONT $GWPID
  step "$side test start"
  (cd $K && swift test --filter KeepaliveMissRealGatewayProofTests 2>&1 | sed 's/\x1b\[[0-9;]*m//g'; echo "exit=$pipestatus[1]") > $E/real-gateway-$side.log
  step "$side test done"
done

sudo -n kill $LOGPID 2>/dev/null; kill -CONT $GWPID; kill $GWPID 2>/dev/null; sleep 3; kill $GWWRAP 2>/dev/null
# Redact: token, hostname, home paths.
H=$(hostname -s)
for f in $E/*.log $E/environment.txt; do
  sed -i '' -e "s/$TOKEN/<redacted-token>/g" -e "s/$H/<host>/g" -e "s#$HOME#~#g" $f
done
step DONE
