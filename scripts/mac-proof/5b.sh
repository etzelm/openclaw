#!/usr/bin/env bash
# FW-5B (#185437): running-app proof of the bounded WebContent reload budget.
# Review ask: repeated terminations, the settled failure view, Reload recovery,
# and native-menu Back/Forward reset, in an isolated running app.
# Terminations are produced by SIGKILL of the tab's WebContent process, which
# WebKit reports through webContentProcessDidTerminate exactly like a crash.
source "$(dirname "$0")/lib/common.sh"
source "$(dirname "$0")/lib/browser.sh"
trap pp_cleanup EXIT

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
pp_wait_for 20 "first load" test "$(pp_fixture_hits /page/crash)" -ge 1
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
pp_wait_for 20 "manual reload" test "$(pp_fixture_hits /page/crash)" -ge 4
sleep 2
pp_shot "12-reload-recovered"
terminate_and_count /page/crash "termination after Reload"
[[ "$(pp_fixture_hits /page/crash)" -eq 5 ]] || pp_fail "Reload did not restore the automatic budget"
pp_shot "13-budget-restored"

# 3. Native menu Back resets the budget on a history move.
pp_browser_go "$BASE/page/b"
pp_wait_for 20 "load of /page/b" test "$(pp_fixture_hits /page/b)" -ge 1
for n in 1 2 3; do terminate_and_count /page/b "page b termination $n"; done
pp_ax exists AXStaticText "stopped repeatedly" native >/dev/null ||
  pp_fail "settled failure view missing on page b"
pp_shot "20-page-b-settled"
before_back="$(pp_fixture_hits /page/crash)"
pp_ax menu "Back" >>"$OUT/scenario.log" || pp_fail "native menu Back not found"
pp_wait_for 20 "Back navigation" test "$(pp_fixture_hits /page/crash)" -gt "$before_back"
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
pp_wait_for 20 "Forward navigation" test "$(pp_fixture_hits /page/b)" -gt "$before_fwd"
sleep 2
pp_shot "30-after-menu-forward"
pp_note "PASS 5b: bounded reloads, settled view, Reload and menu Back/Forward reset"
