#!/usr/bin/env bash
# RFC 0039 foreground proof on a scratch Gateway (draft implementation, pending RFC acceptance).
#
# Runs the shipped Gateway from this checkout (after `pnpm build`) with trusted-proxy auth,
# two people (staff on the default role, a guest on a role with execution "foreground-only"),
# a loopback OpenAI-compatible stub model, and the local Docker or Podman sandbox. Every
# expectation is a PASS/FAIL check; the script exits non-zero when any check fails.
#
# Usage, from the repository root:
#   qa/rfc0039-foreground/run-proof.sh main
#   qa/rfc0039-foreground/run-proof.sh upgrade-base   # on the previous build, writes state
#   qa/rfc0039-foreground/run-proof.sh upgrade-head   # on this build, reuses that state
#
# Environment: PROOF_ROOT (scratch directory, default a new temp dir; upgrade modes need the
# same value), PROOF_COMMIT (commit under test, for the log), DOCKER_HOST (sandbox engine).
set -u
MODE="${1:-main}"
HARNESS="$(cd "$(dirname "$0")" && pwd)"
ROOT="${PROOF_ROOT:-$(mktemp -d)}"
PORT="${PROOF_PORT:-19190}"
export STUB_PORT="${PROOF_STUB_PORT:-19191}"
STAFF="staff@example.test"
GUEST="guest@example.test"
mkdir -p "$ROOT"
export HOME="$ROOT/home" OPENCLAW_STATE_DIR="$ROOT/state" OPENCLAW_CONFIG_PATH="$ROOT/openclaw.json"
export OPENCLAW_SKIP_CHANNELS=1
export STUB_LOG="$ROOT/stub-$MODE.jsonl"
FAILED=0

say() { echo "=== $*"; }
redact() { sed -e "s#$ROOT#<scratch>#g"; }
check() { # name actual expected
  if [ "$2" = "$3" ]; then echo "PASS $1 ($2)"; else echo "FAIL $1 (got $2, expected $3)"; FAILED=$((FAILED + 1)); fi
}
OUT=""
rpc() {
  echo "\$ rpc as ${1%%@*}: $2 $3"
  OUT="$(node --import ./scripts/tsx.mjs "$HARNESS/ws-client.mts" "$PORT" "$1" "$2" "$3" 2>&1)"
  echo "$OUT" | redact | head -c 900; echo
}
HOLDN=0
# rpc_hold: like rpc, but the authenticated connection stays open (a live tab) for $4 ms.
rpc_hold() {
  HOLDN=$((HOLDN + 1)); local out="$ROOT/hold-$MODE-$HOLDN.out"
  echo "\$ rpc as ${1%%@*} (tab open ${4}ms): $2 $3"
  HOLD_MS="$4" node --import ./scripts/tsx.mjs "$HARNESS/ws-client.mts" "$PORT" "$1" "$2" "$3" > "$out" 2>&1 &
  for _ in $(seq 1 30); do grep -q '"ok"' "$out" 2>/dev/null && break; sleep 0.5; done
  OUT="$(cat "$out")"; echo "$OUT" | redact | head -c 600; echo
}
quiet_rpc() { OUT="$(node --import ./scripts/tsx.mjs "$HARNESS/ws-client.mts" "$PORT" "$1" "$2" "$3" 2>&1)"; }
jget() { echo "$OUT" | sed -n '/^{/,$p' | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{const j=JSON.parse(s);const v=($1);process.stdout.write(v==null?'':String(v))}catch{process.stdout.write('')}})"; }
stub() { node "$HARNESS/stub-count.mjs" "$STUB_LOG" "$@"; }
wait_stub() { for _ in $(seq 1 90); do [ "$(stub requests "$1")" -ge "$2" ] && return 0; sleep 1; done; say "timeout waiting for model request $1"; }
history() { quiet_rpc "$1" chat.history "{\"sessionKey\":\"$2\",\"limit\":100}"; echo "$OUT" | sed -n '/^{/,$p' | node "$HARNESS/history.mjs" "$3"; }
history_count() { quiet_rpc "$1" chat.history "{\"sessionKey\":\"$2\",\"limit\":100}"; echo "$OUT" | sed -n '/^{/,$p' | node "$HARNESS/history.mjs" --count "$3"; }
GW_PID=""
start_gw() {
  say "start Gateway ($1) at ${PROOF_COMMIT:-$(git rev-parse --short=12 HEAD)}"
  node openclaw.mjs gateway run --port "$PORT" > "$ROOT/gw-$MODE-$1.log" 2>&1 &
  GW_PID=$!
  for i in $(seq 1 120); do
    if node -e "fetch('http://127.0.0.1:$PORT/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))" 2>/dev/null; then
      say "Gateway healthy after ${i}s"; return 0
    fi
    kill -0 "$GW_PID" 2>/dev/null || { say "Gateway exited early"; tail -n 30 "$ROOT/gw-$MODE-$1.log" | redact; exit 1; }
    sleep 1
  done
  say "Gateway not healthy"; exit 1
}
stop_gw() { say "graceful stop (SIGTERM)"; kill -TERM "$GW_PID"; wait "$GW_PID"; say "Gateway exited with $?"; }
crash_gw() { say "crash (SIGKILL)"; kill -KILL "$GW_PID"; wait "$GW_PID" 2>/dev/null; say "Gateway killed"; }
# The Gateway's own restart path (SIGUSR2). A foreground Gateway finishes its restart
# shutdown, then exits for a full process restart; this script acts as the supervisor.
RESTARTS=0
restart_gw() {
  RESTARTS=$((RESTARTS + 1))
  say "Gateway restart (SIGUSR2)"
  kill -USR2 "$GW_PID"; wait "$GW_PID"
  grep -h -E "marked [0-9]+ interrupted main session" "$ROOT"/gw-"$MODE"-*.log 2>/dev/null | tail -n 1 | sed -E 's/^[^[]*//' | redact
  start_gw "r$RESTARTS"
}
containers() { docker ps -a --filter "label=openclaw.sandbox=1" --format '{{.Names}}' 2>/dev/null | grep -c . ; }

write_config() {
  local staff='["operator.admin","operator.read","operator.write","operator.sessions.read","operator.sessions.write"]'
  local guest='["operator.read","operator.write","operator.sessions.read","operator.sessions.write"]'
  cat > "$OPENCLAW_CONFIG_PATH" <<EOF
{
  "gateway": {
    "mode": "local", "port": $PORT, "bind": "loopback",
    "trustedProxies": ["127.0.0.1"],
    "auth": {
      "mode": "trusted-proxy",
      "trustedProxy": { "userHeader": "x-forwarded-user", "allowLoopback": true },
      "identityScopes": { "$STAFF": $staff, "$GUEST": $guest }
    },
    "controlUi": { "allowedOrigins": ["https://control.example.test"] },
    "roles": {
      "default": "staff",
      "definitions": {
        "staff": { "sessions": { "others": "write" }, "agents": "*", "scopes": $staff },
        "guest": { "sessions": { "others": "none" }, "execution": "foreground-only", "agents": "*", "scopes": $guest }
      }
    }
  },
  "models": { "providers": { "stub": {
    "baseUrl": "http://127.0.0.1:$STUB_PORT/v1", "apiKey": "stub-local", "api": "openai-completions",
    "models": [{ "id": "slow", "name": "Loopback stub" }] } } },
  "agents": { "defaults": {
    "workspace": "$ROOT/workspace",
    "model": { "primary": "stub/slow" },
    "models": { "stub/slow": { "agentRuntime": { "id": "openclaw" } } },
    "sandbox": { "docker": { "image": "${PROOF_SANDBOX_IMAGE:-openclaw-sandbox:bookworm-slim}" } }
  } }
}
EOF
}

fresh_state() {
  rm -rf "$ROOT/home" "$ROOT/state" "$ROOT/workspace"; mkdir -p "$ROOT/home" "$ROOT/state" "$ROOT/workspace"
  git -C "$ROOT/workspace" init -q -b main
  echo proof > "$ROOT/workspace/README.md"; git -C "$ROOT/workspace" add README.md
  git -C "$ROOT/workspace" -c user.name=proof -c user.email=proof@example.test commit -q -m init
  write_config
}
assign_guest() {
  rpc "$GUEST" users.self '{}'
  GUEST_ID="$(jget 'j.payload?.profile?.id ?? j.payload?.id')"
  rpc "$STAFF" users.setRole "{\"profileId\":\"$GUEST_ID\",\"role\":\"guest\"}"
}

say "mode $MODE, commit ${PROOF_COMMIT:-unknown}"
node "$HARNESS/stub-model.mjs" & STUB_PID=$!
sleep 1
trap 'kill "$STUB_PID" 2>/dev/null; pkill -f "$HARNESS/ws-client.mts" 2>/dev/null' EXIT

if [ "$MODE" = "main" ]; then
  fresh_state
  BEFORE="$(containers)"
  start_gw 1
  assign_guest
  rpc "$GUEST" sessions.create '{"label":"guest-thread"}'; G="$(jget 'j.payload?.key')"
  rpc "$STAFF" sessions.create '{"label":"staff-thread"}'; S="$(jget 'j.payload?.key')"

  say "A: an ordinary guest turn completes"
  rpc_hold "$GUEST" chat.send "{\"sessionKey\":\"$G\",\"message\":\"DELAY:hello first\",\"idempotencyKey\":\"guest-1\"}" 20000
  wait_stub hello 1; sleep 10
  check "A guest reply recorded" "$(history_count "$GUEST" "$G" "assistant:stub reply for hello")" 1

  say "T: the tab closes after admission; the bounded turn still completes"
  rpc_hold "$GUEST" chat.send "{\"sessionKey\":\"$G\",\"message\":\"DELAY:tabwork answer later\",\"idempotencyKey\":\"guest-tab\"}" 2500
  wait_stub tabwork 1; sleep 12
  check "T reply recorded after tab close" "$(history_count "$GUEST" "$G" "assistant:stub reply for tabwork")" 1

  say "B: restart during a guest turn and a staff turn"
  rpc_hold "$GUEST" chat.send "{\"sessionKey\":\"$G\",\"message\":\"SLOW:guestwork please\",\"idempotencyKey\":\"guest-2\"}" 900000
  wait_stub guestwork 1
  say "B1: a second guest message while busy"
  rpc "$GUEST" chat.send "{\"sessionKey\":\"$G\",\"message\":\"SLOW:queuedwork second\",\"idempotencyKey\":\"guest-2b\"}"
  check "B1 busy send refused" "$(echo "$OUT" | grep -c 'It was not queued.')" 1
  rpc "$STAFF" chat.send "{\"sessionKey\":\"$S\",\"message\":\"SLOW:staffwork please\",\"idempotencyKey\":\"staff-1\"}"
  wait_stub staffwork 1
  restart_gw
  sleep 25
  check "B guest turn not replayed (model requests)" "$(stub requests guestwork)" 1
  check "B staff turn resumed (model requests)" "$(stub requests staffwork)" 2
  check "B one restart notice" "$(history_count "$GUEST" "$G" "assistant:Stopped after restart.")" 1
  history "$GUEST" "$G" guest-after-restart
  history "$STAFF" "$S" staff-after-restart

  say "C: same-ID retry of the stopped request"
  rpc "$GUEST" chat.send "{\"sessionKey\":\"$G\",\"message\":\"SLOW:guestwork please\",\"idempotencyKey\":\"guest-2\"}"
  sleep 6
  check "C retry returns a recorded result" "$(jget 'j.ok')" true
  check "C retry not dispatched (model requests)" "$(stub requests guestwork)" 1

  say "D: a fresh request with a new ID runs in the same conversation"
  rpc_hold "$GUEST" chat.send "{\"sessionKey\":\"$G\",\"message\":\"SLOW:freshwork second request\",\"idempotencyKey\":\"guest-3\"}" 900000
  wait_stub freshwork 1
  check "D fresh request dispatched" "$(stub requests freshwork)" 1

  say "E: crash during that guest turn"
  crash_gw
  start_gw 2
  sleep 25
  check "E not replayed after crash" "$(stub requests freshwork)" 1
  check "E unknown-cause notice" "$(history_count "$GUEST" "$G" "assistant:Interrupted, not resumed.")" 1

  say "F: another restart"
  restart_gw
  sleep 15
  check "F no duplicate restart notice" "$(history_count "$GUEST" "$G" "assistant:Stopped after restart.")" 1
  check "F no duplicate crash notice" "$(history_count "$GUEST" "$G" "assistant:Interrupted, not resumed.")" 1

  say "R: reassigning the guest role during a turn whose tab closed"
  rpc_hold "$GUEST" chat.send "{\"sessionKey\":\"$G\",\"message\":\"DELAY:revokework answer later\",\"idempotencyKey\":\"guest-r\"}" 2000
  wait_stub revokework 1; sleep 2
  rpc "$STAFF" users.setRole "{\"profileId\":\"$GUEST_ID\",\"role\":\"staff\"}"
  sleep 10
  check "R no reply recorded after revocation" "$(history_count "$STAFF" "$G" "assistant:stub reply for revokework")" 0
  check "R Gateway aborted the run" "$(grep -h -c -E "runId=guest-r .*operator role changed|operator role changed.*runId=guest-r|run cleanup: runId=guest-r .*aborted=true" "$ROOT"/gw-main-*.log | awk '{s+=$1} END {print (s>0)}')" 1

  say "L: the refused busy message never reached a prompt or the transcript"
  check "L model requests containing refused text" "$(stub seen queuedwork)" 0
  check "L transcript user messages with refused text" "$(history_count "$STAFF" "$G" "user:SLOW:queuedwork")" 0
  stop_gw
  check "sandbox containers unchanged" "$(containers)" "$BEFORE"
elif [ "$MODE" = "upgrade-base" ]; then
  fresh_state
  start_gw 1
  assign_guest
  rpc "$GUEST" sessions.create '{"label":"upgrade-guest"}'; G="$(jget 'j.payload?.key')"
  rpc "$STAFF" sessions.create '{"label":"upgrade-staff"}'; S="$(jget 'j.payload?.key')"
  echo "$G" > "$ROOT/upgrade-guest-key"; echo "$S" > "$ROOT/upgrade-staff-key"; echo "$GUEST_ID" > "$ROOT/upgrade-guest-id"
  rpc_hold "$GUEST" chat.send "{\"sessionKey\":\"$G\",\"message\":\"DELAY:basework before upgrade\",\"idempotencyKey\":\"base-1\"}" 20000
  wait_stub basework 1; sleep 10
  rpc "$STAFF" chat.send "{\"sessionKey\":\"$S\",\"message\":\"DELAY:basestaff before upgrade\",\"idempotencyKey\":\"base-staff-1\"}"
  wait_stub basestaff 1; sleep 10
  say "interrupt a guest turn with the previous build's own restart path"
  rpc_hold "$GUEST" chat.send "{\"sessionKey\":\"$G\",\"message\":\"SLOW:baseinterrupted mid upgrade\",\"idempotencyKey\":\"base-2\"}" 900000
  wait_stub baseinterrupted 1
  kill -USR2 "$GW_PID"; wait "$GW_PID"
  say "previous build stopped; state left for upgrade-head"
  history "$STAFF" "$G" guest-before-upgrade
elif [ "$MODE" = "upgrade-head" ]; then
  G="$(cat "$ROOT/upgrade-guest-key")"; S="$(cat "$ROOT/upgrade-staff-key")"; GUEST_ID="$(cat "$ROOT/upgrade-guest-id")"
  write_config
  start_gw 1
  sleep 25
  check "U previous build's guest reply still readable" "$(history_count "$STAFF" "$G" "assistant:stub reply for basework")" 1
  check "U previous build's staff reply still readable" "$(history_count "$STAFF" "$S" "assistant:stub reply for basestaff")" 1
  check "U interrupted guest turn not replayed on the new build" "$(stub requests baseinterrupted)" 0
  check "U exactly one stop notice for it" "$(history_count "$STAFF" "$G" "assistant:Stopped after restart.|assistant:Interrupted, not resumed.|assistant:This foreground-only request stopped")" 1
  history "$STAFF" "$G" guest-after-upgrade
  say "U: same-ID retry of the request stopped across the upgrade"
  rpc "$GUEST" chat.send "{\"sessionKey\":\"$G\",\"message\":\"SLOW:baseinterrupted mid upgrade\",\"idempotencyKey\":\"base-2\"}"
  sleep 6
  check "U retry not dispatched" "$(stub requests baseinterrupted)" 0
  say "U: a fresh guest request works on the upgraded state"
  rpc_hold "$GUEST" chat.send "{\"sessionKey\":\"$G\",\"message\":\"DELAY:headwork after upgrade\",\"idempotencyKey\":\"head-1\"}" 20000
  wait_stub headwork 1; sleep 10
  check "U fresh reply recorded" "$(history_count "$STAFF" "$G" "assistant:stub reply for headwork")" 1
  stop_gw
else
  echo "unknown mode $MODE"; exit 2
fi
say "checks failed: $FAILED"
[ "$FAILED" -eq 0 ]
