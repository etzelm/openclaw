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

# HID clicks (raw or screen coordinates), AXFocused, AXPress, AXValue, and Tab
# never moved DOM focus into the web address field on the hosted runner (runs
# 40561143504 to 40627169152); keystrokes fell through to the chat composer.
# Browser actions > New browser tab opens a native tab and focuses the address
# field from the page itself (focusAddress in
# ui/src/components/browser/browser-panel-native-owner.ts), so type after that.
pp_browser_new_tab_go() {
  # pp_browser_new_tab_go <url>: New browser tab, type, verify, Return.
  local value composer
  pp_app_activate
  # The "..." Menu trigger is exposed as AXPopUpButton; the toolbar group shares its label.
  pp_ax press AXPopUpButton "Browser actions" web >/dev/null || pp_fail "Browser actions menu not found"
  if ! pp_wait_quiet 6 pp_ax exists "*" "New browser tab" web; then
    pp_ax dump "$OUT/logs/ax-browser-actions.json" >/dev/null || true
    pp_fail "New browser tab not in Browser actions (see logs/ax-browser-actions.json)"
  fi
  pp_ax press "*" "New browser tab" web >/dev/null || pp_fail "New browser tab could not be pressed"
  sleep 3
  osascript -e "tell application \"System Events\" to keystroke \"$1\""
  value="$(pp_ax value AXTextField "$PP_ADDRESS_LABEL" web)" || value=""
  if [[ "$value" != *"$1"* ]]; then
    composer="$(pp_ax value AXTextArea "Chat composer" web)" || composer=""
    pp_ax dump "$OUT/logs/ax-address-typed.json" >/dev/null || true
    pp_fail "typed URL not in the address field (value '$value'; composer '$composer'; see logs/ax-address-typed.json)"
  fi
  osascript -e 'tell application "System Events" to key code 36'
  pp_note "new tab navigate $1"
}

LATE_A=$((PP_FIXTURE_PORT + 1)) # nothing listens until recovery
LATE_B=$((PP_FIXTURE_PORT + 2))

pp_identity
pp_build_helpers
pp_dashboard_up
# The recorder follows the PR build's windows, so it starts once the app is up.
[[ "${PP_LOCAL:-}" == 1 ]] || pp_record_start
pp_browser_panel_open
if [[ "${PP_LOCAL:-}" == 1 ]]; then
  # A personal machine lists its own sessions in the sidebar; keep them out of
  # the evidence (the 00/01 shots above are dropped by the local runner).
  pp_ax press AXButton "Collapse sidebar" web >/dev/null || pp_fail "could not collapse the sidebar"
  sleep 1
  pp_record_start
fi

# 1. New tab, first load fails (connection refused on a loopback port).
pp_browser_new_tab_go "http://127.0.0.1:$LATE_A/first-load"
sleep 6
# The failure view is a native subview of the tab's WKWebView; WebKit may expose
# it inside the AXWebArea, so search both scopes for the title.
# The failure view is an AppKit subview of the tab's WKWebView, which WebKit
# keeps out of the accessibility tree; read it from the window instead.
pp_wait_screen_text 10 "couldn't be opened" >"$OUT/logs/failure-view-first-load.txt" ||
  pp_fail "native failure view missing after failed first load"
pp_screen_text "Could not connect" >>"$OUT/logs/failure-view-first-load.txt" || true
pp_shot "10-new-tab-failed"
pp_ax frame AXTextField "$PP_ADDRESS_LABEL" web >"$OUT/logs/address-after-first-failure.json" || true
pp_ax value AXTextField "$PP_ADDRESS_LABEL" web >"$OUT/logs/address-after-first-failure.txt" || true
pp_ax dump "$OUT/logs/ax-new-tab-failed.json" >/dev/null || true

# 2. Native Reload retries the attempted address once it is reachable. The
# recovered page links to an address nothing serves yet, for step 3.
export FIXTURE_NEXT_URL="http://127.0.0.1:$LATE_B/broken"
pp_fixture_start "$LATE_A"
unset FIXTURE_NEXT_URL
# The failure view's own Reload button (the only "Reload" text below its title;
# the toolbar Reload is an icon), clicked through HID with the PR build in front.
at="$(pp_click_screen_text "Reload" "couldn't be opened")" ||
  pp_fail "failure view Reload button not found after the failed first load"
pp_note "pressed the failure view's Reload at $at"
pp_wait_for 20 "retry of /first-load" hits_ge /first-load 1
pp_wait_screen_text_gone 10 "couldn't be opened" || pp_fail "failure view still shown after native Reload"
sleep 3
pp_shot "11-new-tab-recovered-native-reload"

# 3. The recovered tab is a loaded page; following its link to an unserved
# address fails, and the tab keeps the attempted address.
pp_ax exists AXLink "continue to the next address" >/dev/null || {
  pp_ax dump "$OUT/logs/ax-loaded-page.json" >/dev/null || true
  pp_fail "loaded page has no continue link (see logs/ax-loaded-page.json)"
}
pp_shot "20-loaded-page"
pp_ax press AXLink "continue to the next address" >/dev/null || pp_fail "continue link could not be pressed"
pp_note "navigate http://127.0.0.1:$LATE_B/broken from the loaded page"
sleep 6
pp_wait_screen_text 10 "couldn't be opened" >"$OUT/logs/failure-view-navigation.txt" ||
  pp_fail "native failure view missing after failed navigation from a loaded page"
pp_screen_text "Could not connect" >>"$OUT/logs/failure-view-navigation.txt" || true
pp_shot "21-loaded-tab-failed"
pp_ax frame AXTextField "$PP_ADDRESS_LABEL" web >"$OUT/logs/address-after-nav-failure.json" || true
pp_ax value AXTextField "$PP_ADDRESS_LABEL" web >"$OUT/logs/address-after-nav-failure.txt" || true

# 4. Toolbar Reload (Control UI chrome) retries the attempted address too.
pp_fixture_start "$LATE_B"
pp_ax press AXButton "Reload" web >/dev/null || pp_fail "toolbar Reload button not found"
pp_wait_for 20 "retry of /broken" hits_ge /broken 1
pp_wait_screen_text_gone 10 "couldn't be opened" || pp_fail "failure view still shown after toolbar Reload"
sleep 3
pp_shot "22-loaded-tab-recovered-toolbar-reload"
pp_note "PASS 5a: first-load failure, navigation failure, native and toolbar Reload recovery"
