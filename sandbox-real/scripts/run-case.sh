#!/bin/sh
# run-case.sh <profile> <none|ro|rw> <label>
# Starts the repo mock provider + loopback Gateway for one profile, drives one real
# sandboxed turn, and records host-side verification. Everything under $STAGE.
NAME=$1; ACCESS=$2; LABEL=$3
export PATH=/opt/homebrew/bin:/usr/local/bin:$PATH
STAGE=$HOME/Library/Caches/pr165112-sandbox
REPO=$STAGE/repo
P=$STAGE/profiles/$NAME
OUT=$STAGE/out/$LABEL
MOCK_PORT=28411; GW_PORT=28412
mkdir -p "$OUT"
export PR_STAGE=$STAGE
export OPENCLAW_HOME=$P/home OPENCLAW_STATE_DIR=$P/state OPENCLAW_CONFIG_PATH=$P/state/openclaw.json
export OPENAI_API_KEY=sk-pr165112-synthetic OPENCLAW_SKIP_CHANNELS=1 OPENCLAW_NO_RESPAWN=1
export MOCK_PORT MOCK_RESPONSE_CONTROL=$OUT/mock-control.json MOCK_REQUEST_LOG=$OUT/mock-requests.jsonl
export OPENCLAW_MOCK_OPENAI_REQUEST_LOG_BODY_MAX_BYTES=16000000 OPENCLAW_MOCK_OPENAI_REQUEST_MAX_BYTES=16000000
cd "$REPO" || exit 9
: > "$MOCK_REQUEST_LOG"

node "$STAGE/h/harness.mjs" sandbox "$NAME" "$ACCESS" > "$OUT/setup.log" 2>&1
node "$STAGE/h/harness.mjs" controls "$NAME" >> "$OUT/setup.log" 2>&1
node "$STAGE/h/harness.mjs" script "$NAME" "$MOCK_RESPONSE_CONTROL" >> "$OUT/setup.log" 2>&1
# profile config used for this run, with the host profile path redacted
sed "s#$P#<profile>#g" "$OPENCLAW_CONFIG_PATH" > "$OUT/config.redacted.json"
SOUL=$P/workspace/dev/SOUL.md
echo "sha256_before $(shasum -a 256 "$SOUL" | cut -d' ' -f1)" > "$OUT/host-verify.txt"

if [ -n "$(lsof -nP -tiTCP:$GW_PORT -tiTCP:$MOCK_PORT -sTCP:LISTEN 2>/dev/null)" ]; then echo "ports busy" > "$OUT/ABORT"; exit 8; fi
node scripts/e2e/mock-openai-server.mjs > "$OUT/mock.log" 2>&1 &
MOCK_PID=$!
node openclaw.mjs gateway --port $GW_PORT --bind loopback --allow-unconfigured > "$OUT/gateway.log" 2>&1 &
GW_PID=$!
i=0
while [ $i -lt 90 ]; do
  curl -fsS -m 2 "http://127.0.0.1:$GW_PORT/healthz" >/dev/null 2>&1 && break
  i=$((i+1)); sleep 2
done
echo "gateway_wait_iterations=$i" >> "$OUT/setup.log"

node openclaw.mjs agent --agent main --session-id "pr165112-$LABEL" --json --timeout 420 \
  --message "pr165112 sandbox probe run" > "$OUT/agent-turn.json" 2> "$OUT/agent-turn.err"
echo "agent_exit=$?" >> "$OUT/setup.log"

docker ps -a --filter name=pr165112- --format '{{.Names}} {{.Image}} {{.Status}}' > "$OUT/docker-ps.txt" 2>&1
for c in $(docker ps -a --filter name=pr165112-sbx- --format '{{.Names}}'); do
  docker inspect --format '{{json .Mounts}}' "$c" | sed "s#$P#<profile>#g" > "$OUT/docker-mounts.$c.json"
  docker inspect --format 'Config.WorkingDir={{.Config.WorkingDir}} User={{.Config.User}} NetworkMode={{.HostConfig.NetworkMode}} Binds={{json .HostConfig.Binds}}' "$c" | sed "s#$P#<profile>#g" > "$OUT/docker-config.$c.txt"
done

echo "sha256_after $(shasum -a 256 "$SOUL" | cut -d' ' -f1)" >> "$OUT/host-verify.txt"
echo "--- dev/SOUL.md content after:" >> "$OUT/host-verify.txt"
cat "$SOUL" >> "$OUT/host-verify.txt"
echo "--- probe files present on host under <profile>/workspace (pr165112-*, excluding control files):" >> "$OUT/host-verify.txt"
find "$P/workspace" -name 'pr165112-*' ! -name 'pr165112-control.txt' 2>/dev/null | sed "s#$P#<profile>#g" | sort >> "$OUT/host-verify.txt"
echo "--- sandbox dir under state (access none workspace):" >> "$OUT/host-verify.txt"
find "$P/state/sandboxes" -maxdepth 3 -name 'pr165112-*' 2>/dev/null | sed "s#$P#<profile>#g" | sort >> "$OUT/host-verify.txt"

kill $GW_PID $MOCK_PID 2>/dev/null
i=0; while kill -0 $GW_PID 2>/dev/null && [ $i -lt 20 ]; do i=$((i+1)); sleep 1; done
kill -9 $GW_PID $MOCK_PID 2>/dev/null
for p in $(lsof -nP -tiTCP:$GW_PORT -tiTCP:$MOCK_PORT -sTCP:LISTEN 2>/dev/null); do kill $p 2>/dev/null; done
i=0; while [ -n "$(lsof -nP -tiTCP:$GW_PORT -tiTCP:$MOCK_PORT -sTCP:LISTEN 2>/dev/null)" ] && [ $i -lt 20 ]; do i=$((i+1)); sleep 1; done
for c in $(docker ps -a --filter name=pr165112-sbx- --format '{{.Names}}'); do docker rm -f "$c" >> "$OUT/docker-cleanup.txt" 2>&1; done
sed -i '' "s#$P#<profile>#g" "$OUT"/*.log "$OUT"/*.err "$OUT"/*.json "$OUT"/*.jsonl 2>/dev/null
echo CASE_DONE > "$OUT/DONE"
