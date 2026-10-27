#!/usr/bin/env bash
# FW-5B (#185437): running-app proof of the bounded WebContent reload budget.
# Review ask: repeated terminations, the settled failure view, Reload recovery,
# and native-menu Back/Forward reset, in an isolated running app.
# Terminations are produced by SIGKILL of the tab's WebContent process, which
# WebKit reports through webContentProcessDidTerminate exactly like a crash.
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

BASE="http://127.0.0.1:$PP_FIXTURE_PORT"
BASELINE="$PP_ROOT/webcontent-baseline.txt"

terminate_and_count() {
  # terminate_and_count <path> <label>: one termination, then report loads.
  pp_kill_newest_webcontent "$BASELINE"
  sleep 5
  pp_note "$2: loads of $1 = $(pp_fixture_hits "$1")"
}

pp_identity
pp_build_helpers
pp_record_start
pp_dashboard_up
pp_browser_panel_open
pp_webcontent_pids >"$BASELINE"

# 1. Budget of two automatic reloads, then the settled failure view.
pp_browser_go "$BASE/page/crash"
pp_wait_for 20 "first load" hits_ge /page/crash 1
pp_shot "10-loaded"
terminate_and_count /page/crash "termination 1"
terminate_and_count /page/crash "termination 2"
terminate_and_count /page/crash "termination 3"
loads="$(pp_fixture_hits /page/crash)"
[[ "$loads" -eq 3 ]] || pp_fail "expected 3 loads (1 + 2 automatic reloads), saw $loads"
pp_ax exists AXStaticText "stopped repeatedly" native >/dev/null ||
  pp_fail "settled failure view missing after the third termination"
pp_shot "11-settled-failure-view"
sleep 8
[[ "$(pp_fixture_hits /page/crash)" -eq 3 ]] || pp_fail "tab kept reloading after the budget was spent"

# 2. Reload recovers and restores the budget.
pp_click_element AXButton "Reload" native || pp_fail "native Reload button not found"
pp_wait_for 20 "manual reload" hits_ge /page/crash 4
sleep 2
pp_shot "12-reload-recovered"
terminate_and_count /page/crash "termination after Reload"
[[ "$(pp_fixture_hits /page/crash)" -eq 5 ]] || pp_fail "Reload did not restore the automatic budget"
pp_shot "13-budget-restored"

# 3. Native menu Back resets the budget on a history move.
pp_browser_go "$BASE/page/b"
pp_wait_for 20 "load of /page/b" hits_ge /page/b 1
for n in 1 2 3; do terminate_and_count /page/b "page b termination $n"; done
pp_ax exists AXStaticText "stopped repeatedly" native >/dev/null ||
  pp_fail "settled failure view missing on page b"
pp_shot "20-page-b-settled"
before_back="$(pp_fixture_hits /page/crash)"
pp_ax menu "Back" >>"$OUT/scenario.log" || pp_fail "native menu Back not found"
pp_wait_for 20 "Back navigation" hits_gt /page/crash "$before_back"
sleep 2
pp_shot "21-after-menu-back"
after_back="$(pp_fixture_hits /page/crash)"
terminate_and_count /page/crash "termination after Back"
[[ "$(pp_fixture_hits /page/crash)" -gt "$after_back" ]] ||
  pp_fail "menu Back did not restore the automatic budget"
pp_shot "22-back-budget-restored"

# 4. Forward from the menu, same reset.
before_fwd="$(pp_fixture_hits /page/b)"
pp_ax menu "Forward" >>"$OUT/scenario.log" || pp_fail "native menu Forward not found"
pp_wait_for 20 "Forward navigation" hits_gt /page/b "$before_fwd"
sleep 2
pp_shot "30-after-menu-forward"
# Back left one automatic reload; two more reloads need a fresh budget.
after_fwd="$(pp_fixture_hits /page/b)"
terminate_and_count /page/b "termination 1 after Forward"
terminate_and_count /page/b "termination 2 after Forward"
[[ "$(pp_fixture_hits /page/b)" -ge $((after_fwd + 2)) ]] ||
  pp_fail "menu Forward did not restore the automatic budget"
pp_ax exists AXStaticText "stopped repeatedly" native >/dev/null &&
  pp_fail "failure view shown while the Forward budget had reloads left"
pp_shot "31-forward-budget-restored"
pp_note "PASS 5b: bounded reloads, settled view, Reload and menu Back/Forward reset"
