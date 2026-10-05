#!/bin/sh
# run-doctor.sh <profile>  -- runs the patched Doctor against one profile, keeps verbatim output
NAME=$1
export PATH=/opt/homebrew/bin:/usr/local/bin:$PATH
STAGE=$HOME/Library/Caches/pr165112-sandbox
P=$STAGE/profiles/$NAME
OUT=$STAGE/out/doctor-$NAME
mkdir -p "$OUT"
export OPENCLAW_HOME=$P/home OPENCLAW_STATE_DIR=$P/state OPENCLAW_CONFIG_PATH=$P/state/openclaw.json
export OPENAI_API_KEY=sk-pr165112-synthetic OPENCLAW_SKIP_CHANNELS=1
cd "$STAGE/repo" || exit 9
cp "$OPENCLAW_CONFIG_PATH" "$OUT/config.before.json"
(cd "$P/workspace" && find . | sort) > "$OUT/tree.before.txt"
node openclaw.mjs doctor --fix --non-interactive > "$OUT/doctor.out" 2>&1
echo "doctor_exit=$?" >> "$OUT/doctor.out"
cp "$OPENCLAW_CONFIG_PATH" "$OUT/config.after.json"
(cd "$P/workspace" && find . | sort) > "$OUT/tree.after.txt"
diff "$OUT/config.before.json" "$OUT/config.after.json" > "$OUT/config.diff.txt"
sed -i '' "s#$P#<profile>#g" "$OUT"/*
echo DOCTOR_DONE > "$OUT/DONE"
