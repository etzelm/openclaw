#!/usr/bin/env bash
# FW-5A (#185432): running-app proof of Browser tab load failures.
# Review ask: failed first load and loaded-page navigation, the attempted
# address in Browser chrome, recovery through the native and toolbar Reload.
source "$(dirname "$0")/lib/common.sh"
source "$(dirname "$0")/lib/browser.sh"
trap pp_cleanup EXIT

# The Browser shortcut belongs to the chat pane (a document keydown listener in
# ui/src/pages/chat/chat-pane-lifecycle.ts); Model Setup does not handle it. A
# Gateway without a default model sends the first run to Model Setup
# (ui/src/pages/model-setup/first-run.ts), so give it a model id to land on the
# default chat. No agent turn runs, so the model is never called.
pp_dashboard_up() {
  pp_gateway_start '{"gateway":{"mode":"local"},"agents":{"defaults":{"model":"openai/gpt-5"}}}'
  pp_fixture_start "$PP_FIXTURE_PORT"
  pp_app_config
  pp_app_launch --dashboard
  pp_ax wait-window 90 >/dev/null || pp_fail "dashboard window never appeared"
  sleep 10
  pp_shot "00-dashboard"
}

pp_browser_panel_open() {
  pp_app_activate
  if ! pp_wait_quiet 8 pp_ax exists AXButton "Panels" web; then
    pp_note "chat pane not shown; leaving the current page"
    pp_ax press "*" "Back to app" web >/dev/null || osascript -e 'tell application "System Events" to key code 53'
    pp_wait_quiet 8 pp_ax exists AXButton "Panels" web || {
      pp_ax dump "$OUT/logs/ax-no-chat.json" >/dev/null || true
      pp_fail "chat pane never appeared (see logs/ax-no-chat.json)"
    }
  fi
  # The Cmd+Option+Shift+U shortcut cannot match here: with Option held the key
  # is "¨", and resolveAsciiShortcutKey (src/shared/keyboard-shortcuts.ts)
  # returns null for a non-ASCII key when altKey is set. Use the Panels launcher,
  # pressed through accessibility (a coordinate click on Panels did not open it).
  pp_ax press AXButton "Panels" web >/dev/null || pp_fail "Panels button not found"
  if ! pp_wait_quiet 6 pp_ax exists AXButton "Browser" web; then
    pp_ax dump "$OUT/logs/ax-panels.json" >/dev/null || true
    pp_fail "Browser entry not found in Panels (see logs/ax-panels.json)"
  fi
  pp_note "Panels launcher open"
  pp_ax press AXButton "Browser" web >/dev/null || pp_fail "Browser entry could not be pressed"
  pp_wait_quiet 8 pp_ax exists AXTextField "$PP_ADDRESS_LABEL" web || {
    pp_ax dump "$OUT/logs/ax-browser-panel.json" >/dev/null || true
    pp_fail "Browser panel did not open (see logs/ax-browser-panel.json)"
  }
  sleep 2
  pp_ax dump "$OUT/logs/ax-browser-panel.json" >/dev/null || true
  pp_shot "01-browser-panel"
}

# Fixture counts are re-read on every poll (a "$(...)" argument to pp_wait_for
# would be evaluated once, before the wait starts).
hits_ge() { [[ "$(pp_fixture_hits "$1")" -ge "$2" ]]; }
hits_gt() { [[ "$(pp_fixture_hits "$1")" -gt "$2" ]]; }

# HID clicks (raw or screen coordinates) and AXFocused do not move DOM focus into
# the web address field on the hosted runner (runs 40561143504, 40609921512,
# 40614875172). The side panel's own New tab button creates a side panel tab, not
# a browser tab (run 40618185563), so it is not a focus path. Set the field's
# AXValue (WebKit maps it to the DOM value and fires input), verify it, then
# press the toolbar Go button; fall back to AXPress focus + typing.
pp_browser_go() {
  # pp_browser_go <url>: set the address field, verify, then Go.
  local value
  pp_app_activate
  value="$(pp_ax set-value AXTextField "$PP_ADDRESS_LABEL" web "$1")" || value=""
  if ! pp_ax exists AXButton "Go" web >/dev/null 2>&1; then
    # AXValue set the DOM value but not the draft state; focus and type instead.
    pp_ax press AXTextField "$PP_ADDRESS_LABEL" web >/dev/null 2>&1 || true
    sleep 1
    osascript -e 'tell application "System Events" to keystroke "a" using command down'
    osascript -e "tell application \"System Events\" to keystroke \"$1\""
    value="$(pp_ax value AXTextField "$PP_ADDRESS_LABEL" web)" || value=""
  fi
  if [[ "$value" != *"$1"* ]]; then
    pp_ax dump "$OUT/logs/ax-address-typed.json" >/dev/null || true
    pp_fail "typed URL not in the address field (value '$value'; see logs/ax-address-typed.json)"
  fi
  # The toolbar action becomes Go when the draft differs from the active URL;
  # its presence proves the draft state took the value, not just the DOM value.
  if pp_ax exists AXButton "Go" web >/dev/null 2>&1; then
    pp_ax press AXButton "Go" web >/dev/null || pp_fail "Go button could not be pressed"
    pp_note "navigate $1 (Go)"
  else
    pp_ax dump "$OUT/logs/ax-address-no-go.json" >/dev/null || true
    pp_fail "address draft did not reach the Go state (see logs/ax-address-no-go.json)"
  fi
}

LATE_A=$((PP_FIXTURE_PORT + 1)) # nothing listens until recovery
LATE_B=$((PP_FIXTURE_PORT + 2))

pp_identity
pp_build_helpers
pp_record_start
pp_dashboard_up
pp_browser_panel_open

# 1. New tab, first load fails (connection refused on a loopback port).
pp_browser_go "http://127.0.0.1:$LATE_A/first-load"
sleep 6
# The failure view is a native subview of the tab's WKWebView; WebKit may expose
# it inside the AXWebArea, so search both scopes for the title.
pp_ax exists AXStaticText "couldn't be opened" >/dev/null ||
  pp_fail "native failure view missing after failed first load"
pp_shot "10-new-tab-failed"
pp_ax frame AXTextField "$PP_ADDRESS_LABEL" web >"$OUT/logs/address-after-first-failure.json" || true
pp_ax value AXTextField "$PP_ADDRESS_LABEL" web >"$OUT/logs/address-after-first-failure.txt" || true
pp_ax dump "$OUT/logs/ax-new-tab-failed.json" >/dev/null || true

# 2. Native Reload retries the attempted address once it is reachable.
pp_fixture_start "$LATE_A"
if ! pp_ax press AXButton "Reload" native >/dev/null 2>&1; then
  # The failure view may sit inside the AXWebArea; press the lowest Reload
  # (the failure view is in the tab content, the toolbar is at the top).
  frame="$(pp_ax press-lowest AXButton "Reload" 2>/dev/null)" ||
    pp_fail "no Reload button found after the failed first load"
  pp_note "native Reload not exposed as native AX; pressed lowest Reload $frame"
fi
pp_wait_for 20 "retry of /first-load" hits_ge /first-load 1
sleep 3
pp_shot "11-new-tab-recovered-native-reload"

# 3. Loaded page, then a failing navigation keeps the attempted address.
pp_browser_go "http://127.0.0.1:$PP_FIXTURE_PORT/page/a"
pp_wait_for 20 "load of /page/a" hits_ge /page/a 1
sleep 2
pp_shot "20-loaded-page"
pp_browser_go "http://127.0.0.1:$LATE_B/broken"
sleep 6
pp_ax exists AXStaticText "couldn't be opened" >/dev/null ||
  pp_fail "native failure view missing after failed navigation from a loaded page"
pp_shot "21-loaded-tab-failed"
pp_ax frame AXTextField "$PP_ADDRESS_LABEL" web >"$OUT/logs/address-after-nav-failure.json" || true
pp_ax value AXTextField "$PP_ADDRESS_LABEL" web >"$OUT/logs/address-after-nav-failure.txt" || true

# 4. Toolbar Reload (Control UI chrome) retries the attempted address too.
pp_fixture_start "$LATE_B"
pp_ax press AXButton "Reload" web >/dev/null || pp_fail "toolbar Reload button not found"
pp_wait_for 20 "retry of /broken" hits_ge /broken 1
sleep 3
pp_shot "22-loaded-tab-recovered-toolbar-reload"
pp_note "PASS 5a: first-load failure, navigation failure, native and toolbar Reload recovery"
