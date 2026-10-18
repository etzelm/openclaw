#!/bin/bash
# usage: run-arm.sh <arm-dir> <arm-label> <workload W1|W2|W3> <store dev|main|none> <run-root> [tag]
# Same script for both arms. One arm, one workload, one store, one run. Every CLI command goes through oc.mjs.
# Agent id follows the store (dev store belongs to agent dev; main and none use main). Both stores need doctor, agents add, doctor.
# Env: T203_STUB_PORT (default 47631; fixed so provider_key is the same in every run), T203_STORES (default ~/work/t2-03-vector-transfer-stores), T203_FULL_SNAPSHOT_PRE=1 to hash the store copy before the run too.
set -u
ARMDIR=$1; LABEL=$2; WL=$3; STORE=$4; ROOT=$5; TAG=${6:-r1}
T=$(cd "$(dirname "$0")" && pwd)
STORES=${T203_STORES:-<stores>}
S=$ROOT/$LABEL-$WL-$STORE-$TAG
rm -rf "$S"; mkdir -p "$S/home" "$S/state" "$S/workspace" "$S/snap" "$S/logs" "$S/obs"
TL=$S/transcript.txt
log() { echo "$*" | tee -a "$TL"; }
ms() { node -e 'console.log(Date.now())'; }
log "# arm=$LABEL head=$(git -C "$ARMDIR" rev-parse HEAD) dirty_files=$(git -C "$ARMDIR" status --porcelain | wc -l | tr -d ' ') workload=$WL store=$STORE tag=$TAG"
log "# node $(node -v)"
log "# uptime: $(uptime)"
log "# memory_pressure: $(memory_pressure -Q | tail -1)"
AGENT=main; [ "$STORE" = dev ] && AGENT=dev
DB=$S/state/agents/$AGENT/agent/openclaw-agent.sqlite
if [ "$STORE" != none ]; then
  mkdir -p "$(dirname "$DB")"
  C0=$(ms); cp -c "$STORES/agent-$STORE.sqlite" "$DB" || cp "$STORES/agent-$STORE.sqlite" "$DB"; C1=$(ms)
  log "# store copy: agent-$STORE ($(stat -f %z "$DB") bytes) in $((C1 - C0)) ms"
fi
node "$T/embed-stub.mjs" "$S/stub.port" "$S/embeddings.jsonl" "${T203_STUB_PORT:-47631}" & STUB_PID=$!
for i in $(seq 50); do [ -s "$S/stub.port" ] && break; sleep 0.1; done
PORT=$(cat "$S/stub.port"); : > "$S/embeddings.jsonl"
cat > "$S/state/openclaw.json" <<CFG
{
  agents: { defaults: { workspace: "$S/workspace" }, entries: { "$AGENT": {} } },
  memory: { search: { enabled: true, provider: "openai-compatible", model: "stub-embed-4096", remote: { baseUrl: "http://127.0.0.1:$PORT/v1" }, cache: { enabled: true }, sources: ["memory"], experimental: { sessionMemory: false } } },
  plugins: { slots: { memory: "memory-core" }, entries: { "memory-core": { enabled: true } } },
  gateway: { mode: "local" },
}
CFG
cp "$S/state/openclaw.json" "$S/openclaw.json.run"
node "$T/gen-workload.mjs" "$S/workspace" "$WL" | tee -a "$TL" > "$S/workload.json"
step() { local st=$1; shift; local e0; e0=$(wc -l < "$S/embeddings.jsonl" | tr -d ' ')
  log "\$ openclaw $*"
  node "$T/oc.mjs" "$S" "$st" "$ARMDIR" -- "$@" | tee -a "$TL"
  echo "$e0 $(wc -l < "$S/embeddings.jsonl" | tr -d ' ')" > "$S/logs/$st.embseq"; }
# Prep (not measured): the store copies are schema 24 and, in a fresh state dir, held back by the agent deletion journal.
# doctor (holds the store), agents add (registers it), doctor (migrates the copy); logged under logs/prep-*.
if [ "$STORE" != none ]; then
  node "$T/oc.mjs" "$S" prep-doctor1 "$ARMDIR" -- doctor --fix --non-interactive | tee -a "$TL"
    node "$T/oc.mjs" "$S" prep-agents-add "$ARMDIR" -- agents add "$AGENT" --workspace "$S/workspace" --agent-dir "$S/state/agents/$AGENT/agent" --non-interactive | tee -a "$TL"
  node "$T/oc.mjs" "$S" prep-doctor2 "$ARMDIR" -- doctor --fix --non-interactive | tee -a "$TL"
  rm -f "$S"/state/agents/*/agent/*.bak "$S"/state/*.bak.[0-9]* 2>/dev/null
  rm -rf "$S/state.update-captures"   # doctor pre-migration backups (as large as the store)
fi
if [ "$STORE" != none ]; then
  if [ "${T203_FULL_SNAPSHOT_PRE:-0}" = 1 ]; then node "$T/snapshot-parity.mjs" "$DB" "$S/snap/pre.json" | tee -a "$TL"; else node "$T/snapshot-parity.mjs" "$DB" "$S/snap/pre.json" --counts-only | tee -a "$TL"; fi
fi
START_MS=$(ms); echo "$START_MS" > "$S/start-ms"
step a-index memory index --agent $AGENT --force --verbose
head -c 3000 "$S/logs/a-index.err" | sed 's#<home>[^ ]*#<path>#g' | tail -5 > /dev/null
snap() { local I=$S/snap/tmp; mkdir -p "$I"; for s in "" -wal -shm; do [ -f "$DB$s" ] && cp "$DB$s" "$I/db.sqlite$s"; done
  log "# files after $1: db=$(stat -f %z "$DB") wal=$(stat -f %z "$DB-wal" 2>/dev/null || echo absent)"
  node "$T/snapshot-parity.mjs" "$I/db.sqlite" "$S/snap/$1.json" --since-ms "$START_MS" | tee -a "$TL"; rm -rf "$I"; }
snap a-index
step b-status memory status --agent $AGENT --json
step c-search memory search copperwillow --agent $AGENT --json
kill "$STUB_PID" 2>/dev/null
node "$T/summarize-run.mjs" "$S" | tee "$S/summary.txt" | tee -a "$TL"
if [ "$STORE" = main ] && [ "${T203_KEEP_DB:-0}" != 1 ]; then rm -rf "$S/state/agents"; log "# main-store DB copy deleted after the run (T203_KEEP_DB=1 keeps it)"; fi
log "# uptime end: $(uptime)"
log "# done"
