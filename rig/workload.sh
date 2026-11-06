#!/bin/bash
# Shared by run-lane.sh and trace-lane.sh. Needs WORK, OUT, LOG, KIT, REL and fail().
run_workload() {
  local side="$1" sample="$2"
  CHAT_PERF_PROOF=1 CHAT_PERF_OUT="$OUT/samples" CHAT_PERF_LABEL="$side" CHAT_PERF_SAMPLE="$sample" \
    perl -e 'alarm shift; exec @ARGV' 300 swift test --package-path "$WORK/$side/$KIT" \
    --scratch-path "$WORK/scratch-$side-rel" "${REL[@]}" \
    --skip-build --filter ChatPerfProofWorkload >"$LOG/$side-workload-$sample.log" 2>&1 ||
    { tail -40 "$LOG/$side-workload-$sample.log"; fail "$side workload sample $sample"; }
  grep -E "CHAT_PERF_PROOF|Test run with|failed|error" "$LOG/$side-workload-$sample.log" | head -20
}
