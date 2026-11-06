#!/bin/bash
# Optional Time Profiler trace, one extra workload run per side, after run-lane.sh.
# xctrace attaches to the workload process only (not --all-processes), with hard limits
# on every wait, and only aggregate sample counts are exported.
set -uo pipefail
LANE="$1"
RIG="$(cd "$(dirname "$0")" && pwd)"
WORK="${RUNNER_TEMP:-/tmp}/chatui-proof"
OUT="${PROOF_OUT:-$WORK/out}/$LANE"
LOG="$OUT/logs"
KIT=apps/shared/OpenClawKit
REL=(-c release -Xswiftc -enable-testing --disable-index-store)
fail() { echo "::warning::$*"; echo "TRACE: $*" >>"$OUT/trace-status.txt"; }
# shellcheck source=/dev/null
source "$RIG/workload.sh"

for side in head base; do
  pkill -x xctrace 2>/dev/null; sleep 1
  echo "=== $(date -u +%H:%M:%S) trace $side"
  attach="$WORK/attach-$side"
  rm -rf "$attach" "$WORK/$side.trace"
  mkdir -p "$attach"
  CHAT_PERF_ONLY=cards CHAT_PERF_ATTACH_DIR="$attach" run_workload "$side" trace &
  wpid=$!
  for _ in $(seq 1 600); do [ -s "$attach/pid" ] && break; sleep 0.2; done
  if [ ! -s "$attach/pid" ]; then
    fail "$side: workload pid not published"
    touch "$attach/go"
    wait "$wpid"
    continue
  fi
  target="$(cat "$attach/pid")"
  perl -e 'alarm shift; exec @ARGV' 330 xcrun xctrace record --template 'Time Profiler' \
    --attach "$target" --time-limit 90s --output "$WORK/$side.trace" >"$LOG/$side-xctrace.log" 2>&1 &
  xpid=$!
  for _ in $(seq 1 150); do grep -q "Ctrl-C to stop" "$LOG/$side-xctrace.log" 2>/dev/null && break; sleep 0.2; done
  sleep 2
  touch "$attach/go"
  wait "$wpid"
  # Attached recording ends when the target exits; the alarm above bounds the save.
  wait "$xpid" || { fail "$side: xctrace exited $?"; pkill -9 -x xctrace 2>/dev/null; }
  tail -5 "$LOG/$side-xctrace.log"
  if [ -d "$WORK/$side.trace" ]; then
    perl -e 'alarm shift; exec @ARGV' 240 xcrun xctrace export --input "$WORK/$side.trace" \
      --xpath '/trace-toc/run[@number="1"]/data/table[@schema="time-profile"]' \
      >"$WORK/$side-time-profile.xml" 2>"$LOG/$side-export.log" || fail "$side: export failed"
    python3 -I "$RIG/timeprofile.py" "$side" "$WORK/$side-time-profile.xml" >"$OUT/$side-timeprofile.json" \
      2>>"$LOG/$side-export.log" || fail "$side: time profile reduce failed"
  else
    fail "$side: no trace recorded"
  fi
done

python3 -I "$RIG/summarize.py" "$LANE" "$OUT" "$(python3 -I -c 'import json,sys; print(json.load(open(sys.argv[1]))[sys.argv[2]]["title"])' "$RIG/lanes.json" "$LANE")" >"$OUT/summary.md"
cat "$OUT/summary.md"
[ -s "$OUT/trace-status.txt" ] && cat "$OUT/trace-status.txt"
exit 0
