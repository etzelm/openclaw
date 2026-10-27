#!/usr/bin/env bash
# FW-4A (#185435): packaged-app launch-to-hidden-dashboard-preload in remote mode.
# Review ask: launch arming, successful hidden authentication, and the first
# visible open, with a before/after comparison. Run as two matrix entries:
# VARIANT=base (PR base) and VARIANT=head (patched); compare their artifacts.
# Evidence: the Gateway's own presence list shows whether an authenticated
# Control UI client exists while no dashboard window is on screen, then a
# frame burst of the first visible open.
source "$(dirname "$0")/lib/common.sh"
trap pp_cleanup EXIT

presence() {
  # presence <label>: raw presence plus the Control UI client count.
  pp_call system-presence '{}' >"$OUT/logs/presence-$1.json" 2>&1 || true
  local n
  n="$(grep -o 'openclaw-control-ui' "$OUT/logs/presence-$1.json" | wc -l | tr -d ' ')"
  pp_note "presence $1: control-ui clients=$n"
  echo "$n"
}

pp_identity
pp_build_helpers
pp_record_start
pp_gateway_start '{}'
pp_app_config
before_launch="$(presence before-launch)"

# Normal interactive launch (automatic presentation allowed, no --dashboard).
pp_app_launch
sleep 15
hidden="$(presence after-launch-hidden)"
visible_before="$("$PP_BIN/window-id" OpenClaw 2>/dev/null || echo none)"
pp_note "visible OpenClaw window before open: $visible_before"
screencapture -x "$OUT/shots/10-screen-before-open.png"

# First visible open through the same action as the menu bar item.
open "openclaw://dashboard"
open_at="$(date +%s.%N 2>/dev/null || date +%s)"
for i in $(seq -w 0 15); do
  wid="$("$PP_BIN/window-id" OpenClaw 2>/dev/null || true)"
  [[ -n "$wid" ]] && screencapture -x -o -l "$wid" "$OUT/shots/20-first-open-frame-$i.png"
  sleep 0.25
done
pp_note "first-open frame burst done (16 frames, 250 ms apart, open at $open_at)"
sleep 3
pp_shot "30-dashboard-settled"
after_open="$(presence after-open)"

{
  echo "## FW-4A first dashboard open, remote mode, variant $VARIANT"
  echo
  echo "source: $(git -C "$SRC" rev-parse --short=12 HEAD)"
  echo "| moment | authenticated Control UI clients on the Gateway |"
  echo "|---|---|"
  echo "| before app launch | $before_launch |"
  echo "| 15 s after launch, no dashboard window | $hidden |"
  echo "| after first open | $after_open |"
  echo
  echo "Frames: shots/20-first-open-frame-*.png (frame 00 is ~0 ms after open)."
} >"$OUT/summary.md"

if [[ "$VARIANT" == "head" ]]; then
  [[ "$hidden" -ge 1 ]] || pp_fail "patched build: no hidden authenticated dashboard client before first open"
  pp_note "PASS 4a head: hidden preload authenticated before first open"
else
  pp_note "BASE: hidden control-ui clients before open = $hidden (expected 0)"
fi
