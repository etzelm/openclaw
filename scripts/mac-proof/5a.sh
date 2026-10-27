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
    pp_click_element "*" "Back to app" web || osascript -e 'tell application "System Events" to key code 53'
    pp_wait_quiet 8 pp_ax exists AXButton "Panels" web || {
      pp_ax dump "$OUT/logs/ax-no-chat.json" >/dev/null || true
      pp_fail "chat pane never appeared (see logs/ax-no-chat.json)"
    }
  fi
  pp_app_activate
  osascript -e 'tell application "System Events" to keystroke "u" using {command down, option down, shift down}'
  if ! pp_wait_quiet 10 pp_ax exists AXTextField "$PP_ADDRESS_LABEL" web; then
    pp_note "browser shortcut did not open the panel; using Panels > Browser"
    pp_click_element AXButton "Panels" web || pp_fail "Panels button not found"
    sleep 1
    pp_click_element "*" "Browser" web || pp_fail "Browser entry not found in Panels"
    pp_wait_quiet 15 pp_ax exists AXTextField "$PP_ADDRESS_LABEL" web || {
      pp_ax dump "$OUT/logs/ax-browser-panel.json" >/dev/null || true
      pp_fail "Browser panel did not open (see logs/ax-browser-panel.json)"
    }
  fi
  sleep 2
  pp_ax dump "$OUT/logs/ax-browser-panel.json" >/dev/null || true
  pp_shot "01-browser-panel"
}

# Fixture counts are re-read on every poll (a "$(...)" argument to pp_wait_for
# would be evaluated once, before the wait starts).
hits_ge() { [[ "$(pp_fixture_hits "$1")" -ge "$2" ]]; }
hits_gt() { [[ "$(pp_fixture_hits "$1")" -gt "$2" ]]; }

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
pp_ax exists AXStaticText "couldn't be opened" native >/dev/null ||
  pp_fail "native failure view missing after failed first load"
pp_shot "10-new-tab-failed"
pp_ax frame AXTextField "$PP_ADDRESS_LABEL" web >"$OUT/logs/address-after-first-failure.json" || true
pp_ax dump "$OUT/logs/ax-new-tab-failed.json" >/dev/null || true

# 2. Native Reload retries the attempted address once it is reachable.
pp_fixture_start "$LATE_A"
pp_click_element AXButton "Reload" native || pp_fail "native Reload button not found"
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
pp_ax exists AXStaticText "couldn't be opened" native >/dev/null ||
  pp_fail "native failure view missing after failed navigation from a loaded page"
pp_shot "21-loaded-tab-failed"
pp_ax frame AXTextField "$PP_ADDRESS_LABEL" web >"$OUT/logs/address-after-nav-failure.json" || true

# 4. Toolbar Reload (Control UI chrome) retries the attempted address too.
pp_fixture_start "$LATE_B"
pp_click_element AXButton "Reload" web || pp_fail "toolbar Reload button not found"
pp_wait_for 20 "retry of /broken" hits_ge /broken 1
sleep 3
pp_shot "22-loaded-tab-recovered-toolbar-reload"
pp_note "PASS 5a: first-load failure, navigation failure, native and toolbar Reload recovery"
