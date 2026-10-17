#!/bin/bash
# usage: run-arm.sh <arm: base|head> <mode: keyword|semantic|semantic-nocache> <paragraphs> <run-root>
# Same script for both arms. Every command goes through oc.mjs (full output kept).
set -u
ARM=$1; MODE=$2; PARAS=$3; ROOT=$4
T=$(cd "$(dirname "$0")" && pwd)
CLONE=$ROOT/../$ARM
S=$ROOT/runs/$ARM-$MODE-p$PARAS
rm -rf "$S"; mkdir -p "$S/home" "$S/state" "$S/workspace" "$S/snap" "$S/logs" "$S/obs"
TL=$S/transcript.txt
say() { echo "\$ $*" | tee -a "$TL"; }
log() { echo "$*" | tee -a "$TL"; }
log "# arm=$ARM head=$(git -C "$CLONE" rev-parse HEAD) dirty_files=$(git -C "$CLONE" status --porcelain | wc -l | tr -d ' ') mode=$MODE paragraphs=$PARAS"
log "# node $(node -v)"
STUB_PID=""
if [ "$MODE" != keyword ]; then
  node "$T/embed-stub.mjs" "$S/stub.port" "$S/embeddings.jsonl" & STUB_PID=$!
  for i in $(seq 50); do [ -s "$S/stub.port" ] && break; sleep 0.1; done
  PORT=$(cat "$S/stub.port"); : > "$S/embeddings.jsonl"
  CACHE=true; [ "$MODE" = semantic-nocache ] && CACHE=false
  SEARCH="provider: \"openai-compatible\", model: \"stub-embed-64\", remote: { baseUrl: \"http://127.0.0.1:$PORT/v1\" }, cache: { enabled: $CACHE }, sources: [\"memory\"]"
else
  SEARCH='provider: "none", sources: ["memory"]'
fi
cat > "$S/state/openclaw.json" <<CFG
{
  agents: { defaults: { workspace: "$S/workspace" } },
  memory: { search: { enabled: true, $SEARCH } },
  plugins: { slots: { memory: "memory-core" }, entries: { "memory-core": { enabled: true } } },
  gateway: { mode: "local" },
}
CFG
log "# config"; sed 's/^/  /' "$S/state/openclaw.json" | tee -a "$TL" >/dev/null
DB=$S/state/agents/main/agent/openclaw-agent.sqlite
emb() { [ -f "$S/embeddings.jsonl" ] && wc -l < "$S/embeddings.jsonl" | tr -d ' ' || echo 0; }
snap() { # $1 label
  local I=$S/snap/$1; mkdir -p "$I"
  for s in "" -wal -shm; do [ -f "$DB$s" ] && cp "$DB$s" "$I/db.sqlite$s"; done
  log "# files after $1: db=$(stat -f %z "$DB" 2>/dev/null) wal=$(stat -f %z "$DB-wal" 2>/dev/null || echo absent)"
  node "$T/snapshot.mjs" "$I/db.sqlite" "$S/snap/$1.json" | tee -a "$TL"
  rm -rf "$I"
}
step() { # $1 step, rest openclaw args
  local st=$1; shift
  local e0=$(emb)
  say "openclaw $*"
  node "$T/oc.mjs" "$S" "$st" "$CLONE" -- "$@" | tee -a "$TL"
  cat "$S/logs/$st.out" | tee -a "$TL" >/dev/null
  local e1=$(emb)
  echo "$e0 $e1" > "$S/logs/$st.embseq"
  log "# embedding HTTP requests during $st: $((e1 - e0)) (stub log lines $((e0 + 1))..$e1)"
}
say "node gen-synthetic-notes.mjs <workspace> $PARAS"
node "$T/gen-synthetic-notes.mjs" "$S/workspace" "$PARAS" | tee -a "$TL"
step a-index memory index --agent main --verbose
snap a-index
sleep 2
say "node gen-synthetic-notes.mjs <workspace> $PARAS append"
node "$T/gen-synthetic-notes.mjs" "$S/workspace" "$PARAS" append | tee -a "$TL"
step b-index memory index --agent main --verbose
snap b-index
step c1-search memory search copperwillow --agent main --json
step c2-search memory search tundrabeacon --agent main --json
step d-status memory status --agent main --json
snap d-status
[ -n "$STUB_PID" ] && kill "$STUB_PID"
log "# done"
