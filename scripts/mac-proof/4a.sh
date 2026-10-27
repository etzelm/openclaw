#!/usr/bin/env bash
# FW-4A (#185435): packaged-app launch-to-hidden-dashboard-preload in remote mode.
# Review ask: launch arming, successful hidden authentication, and the first
# visible open, with a before/after comparison. Run as two matrix entries:
# VARIANT=base (PR base) and VARIANT=head (patched); compare their artifacts.
# Evidence: the Gateway commits a presence row only after a successful
# handshake (connect-hello.ts commitPresence), so a Control UI row with its
# connectionId while the dashboard window is off screen is the hidden
# authenticated load. The same connectionId after the first open shows the
# visible window reused that preloaded document. The full CoreGraphics window
# list (on and off screen) shows the hidden window exists but is not visible.
source "$(dirname "$0")/lib/common.sh"
trap pp_cleanup EXIT

build_window_list() {
  # All layer-0 windows of the app, on and off screen, as JSON lines.
  cat >"$PP_ROOT/window-list.swift" <<'SWIFT'
import CoreGraphics
import Foundation

let owner = CommandLine.arguments.dropFirst().first ?? "OpenClaw"
guard let windows = CGWindowListCopyWindowInfo([.optionAll], kCGNullWindowID) as? [[String: Any]] else {
    exit(1)
}
for window in windows where (window[kCGWindowOwnerName as String] as? String) == owner {
    guard (window[kCGWindowLayer as String] as? Int) == 0 else { continue }
    let bounds = window[kCGWindowBounds as String] as? [String: Double] ?? [:]
    let row: [String: Any] = [
        "id": window[kCGWindowNumber as String] as? Int ?? 0,
        "title": window[kCGWindowName as String] as? String ?? "",
        "onScreen": window[kCGWindowIsOnscreen as String] as? Bool ?? false,
        "width": bounds["Width"] ?? 0,
        "height": bounds["Height"] ?? 0,
    ]
    let data = try JSONSerialization.data(withJSONObject: row, options: [.sortedKeys])
    print(String(decoding: data, as: UTF8.self))
}
SWIFT
  swiftc -O -o "$PP_BIN/window-list" "$PP_ROOT/window-list.swift"
}

windows() {
  # windows <label>: full window list to logs/windows-<label>.jsonl.
  "$PP_BIN/window-list" OpenClaw >"$OUT/logs/windows-$1.jsonl" 2>&1 || true
  pp_note "windows $1: $(grep -c '"onScreen":true' "$OUT/logs/windows-$1.jsonl" || true) on screen," \
    "$(grep -c '"onScreen":false' "$OUT/logs/windows-$1.jsonl" || true) off screen" >&2
}

presence() {
  # presence <label>: raw presence, then prints the Control UI connectionIds
  # (space separated, sorted). Notes go to stderr so callers capture only ids.
  pp_call system-presence '{}' >"$OUT/logs/presence-$1.json" 2>&1 || true
  local ids
  ids="$(node -e '
    const fs = require("fs");
    let rows;
    try { rows = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); } catch { rows = []; }
    if (!Array.isArray(rows)) rows = rows.presence ?? rows.entries ?? [];
    const ids = rows
      .filter((r) => r && r.clientId === "openclaw-control-ui")
      .map((r) => r.connectionId ?? "?")
      .sort();
    process.stdout.write(ids.join(" "));
  ' "$OUT/logs/presence-$1.json")"
  pp_note "presence $1: control-ui connections=[${ids}]" >&2
  echo "$ids"
}

count() { [[ -z "$1" ]] && echo 0 || wc -w <<<"$1" | tr -d ' '; }

pp_identity
pp_build_helpers
build_window_list
pp_record_start
pp_gateway_start '{}'
pp_app_config
before_launch="$(presence before-launch)"

# Normal interactive launch (automatic presentation allowed, no --dashboard).
# The patched build arms the preload 2 s after launch and loads once the
# control channel is connected; poll up to 30 s, then take the final reading.
pp_app_launch
launch_at="$(python3 -c 'import time; print(f"{time.time():.3f}")')" # BSD date has no %N
hidden=""
for _ in $(seq 1 30); do
  hidden="$(presence poll 2>/dev/null)"
  [[ -n "$hidden" ]] && break
  sleep 1
done
hidden_at="$(python3 -c 'import time; print(f"{time.time():.3f}")')"
sleep 3
hidden="$(presence after-launch-hidden)"
windows before-open
visible_before="$("$PP_BIN/window-id" OpenClaw 2>/dev/null || echo none)"
pp_note "visible OpenClaw window before open: $visible_before"
screencapture -x "$OUT/shots/10-screen-before-open.png"
for id in $hidden; do
  grep -F "${id:0:8}" "$OUT/logs/gateway.log" >>"$OUT/logs/hidden-connection-gateway.log" 2>/dev/null || true
done

# First visible open through the same action as the menu bar item.
open "openclaw://dashboard"
open_at="$(python3 -c 'import time; print(f"{time.time():.3f}")')"
for i in $(seq -w 0 15); do
  wid="$("$PP_BIN/window-id" OpenClaw 2>/dev/null || true)"
  [[ -n "$wid" ]] && screencapture -x -o -l "$wid" "$OUT/shots/20-first-open-frame-$i.png"
  sleep 0.25
done
pp_note "first-open frame burst done (16 frames, 250 ms apart, open at $open_at)"
sleep 3
pp_shot "30-dashboard-settled"
windows after-open
after_open="$(presence after-open)"

reused="no"
for id in $hidden; do
  [[ " $after_open " == *" $id "* ]] && reused="yes"
done
new_after_open=0
for id in $after_open; do
  [[ " $hidden " == *" $id "* ]] || new_after_open=$((new_after_open + 1))
done
hidden_offscreen="$(grep -c '"onScreen":false' "$OUT/logs/windows-before-open.jsonl" || true)"

{
  echo "## FW-4A first dashboard open, remote mode, variant $VARIANT"
  echo
  echo "source: $(git -C "$SRC" rev-parse --short=12 HEAD)"
  echo
  echo "| moment | authenticated Control UI connections on the Gateway | app windows on screen / off screen |"
  echo "|---|---|---|"
  echo "| before app launch | $(count "$before_launch") | - |"
  echo "| after launch, before any open | $(count "$hidden") | $([[ "$visible_before" == none ]] && echo 0 || echo 1) / ${hidden_offscreen:-0} |"
  echo "| after first open | $(count "$after_open") ($new_after_open new) | $(grep -c '"onScreen":true' "$OUT/logs/windows-after-open.jsonl" || true) / $(grep -c '"onScreen":false' "$OUT/logs/windows-after-open.jsonl" || true) |"
  echo
  echo "- hidden connection authenticated $(python3 -c "print(f'{$hidden_at - $launch_at:.1f}')") s after launch (poll resolution 1 s)."
  echo "- first open reused the hidden connection: $reused."
  echo "- Rows come from \`system-presence\`; the Gateway commits a row only after a successful handshake."
  echo "- Window lists: logs/windows-before-open.jsonl, logs/windows-after-open.jsonl. Gateway lines for the hidden connection: logs/hidden-connection-gateway.log."
  echo "- Frames: shots/20-first-open-frame-*.png (frame 00 is ~0 ms after open)."
} >"$OUT/summary.md"

if [[ "$VARIANT" == "head" ]]; then
  [[ "$visible_before" == none ]] || pp_fail "patched build: a dashboard window was visible before the first open"
  [[ -n "$hidden" ]] || pp_fail "patched build: no authenticated Control UI connection before the first open"
  [[ "$reused" == yes ]] || pp_fail "patched build: first open did not reuse the hidden connection"
  pp_note "PASS 4a head: hidden preload authenticated off screen and reused by the first open"
else
  pp_note "BASE: control-ui connections before open = $(count "$hidden") (expected 0), reused = $reused"
fi
