#!/bin/sh
# run-all.sh: fresh profile per case. phase pre = no Doctor; post = patched Doctor first.
export PATH=/opt/homebrew/bin:/usr/local/bin:$PATH
STAGE=$HOME/Library/Caches/pr165112-sandbox
cd "$STAGE" || exit 9
export PR_STAGE=$STAGE
CASES="${CASES:-pre:subdir pre:neither post:subdir post:neither post:rootonly pre:rootonly}"
for pl in $CASES; do
  phase=${pl%%:*}; layout=${pl##*:}
  for access in none ro rw; do
    label=$phase-$layout-$access
    rm -rf "profiles/$label" "out/$label" "out/doctor-$label"
    node h/harness.mjs init "$label" "$layout" 28411 28412 >/dev/null
    if [ "$phase" = post ]; then sh h/run-doctor.sh "$label"; fi
    sh h/run-case.sh "$label" "$access" "$label"
    echo "finished $label" >> "$HOME/Library/Logs/pr165112-runall.log"
  done
done
echo ALL_DONE >> "$HOME/Library/Logs/pr165112-runall.log"
