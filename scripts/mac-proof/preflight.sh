#!/usr/bin/env bash
# Fails fast if the runner cannot do what the scenarios need: an unlocked GUI
# session, screen capture, and accessibility/event posting for this process tree.
source "$(dirname "$0")/lib/common.sh"

pp_build_helpers
pp_note "macOS $(sw_vers -productVersion), $(xcodebuild -version | head -1)"
# Hosted images pre-grant ScreenCapture, Accessibility and System Events to
# /bin/bash, osascript and the hosted compute agent (runner-images
# configure-tccdb-macos.sh). Logged, not fatal: a CLI's own preflight answer
# can differ from its responsible process; the capture size check below decides.
pp_note "tcc: $("$PP_BIN/tcc-check" 2>&1 || true)"

screencapture -x "$OUT/shots/preflight-screen.png" || pp_fail "screencapture failed"
size="$(stat -f %z "$OUT/shots/preflight-screen.png")"
pp_note "preflight screen capture: $size bytes"
[[ "$size" -gt 20000 ]] || pp_fail "screen capture is empty (locked or headless desktop)"

osascript -e 'tell application "System Events" to get name of first process' >/dev/null ||
  pp_fail "System Events automation refused (no Accessibility/AppleEvents grant)"
pp_note "System Events automation ok"

if ioreg -n Root -d1 -a | grep -q CGSSessionScreenIsLocked; then
  pp_note "warning: CGSSessionScreenIsLocked present"
fi
