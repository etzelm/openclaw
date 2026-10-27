#!/usr/bin/env bash
# FW-5A (#185432): running-app proof of Browser tab load failures.
# Review ask: failed first load and loaded-page navigation, the attempted
# address in Browser chrome, recovery through the native and toolbar Reload.
source "$(dirname "$0")/lib/common.sh"
source "$(dirname "$0")/lib/browser.sh"
trap pp_cleanup EXIT

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
pp_wait_for 20 "retry of /first-load" test "$(pp_fixture_hits /first-load)" -ge 1
sleep 3
pp_shot "11-new-tab-recovered-native-reload"

# 3. Loaded page, then a failing navigation keeps the attempted address.
pp_browser_go "http://127.0.0.1:$PP_FIXTURE_PORT/page/a"
pp_wait_for 20 "load of /page/a" test "$(pp_fixture_hits /page/a)" -ge 1
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
pp_wait_for 20 "retry of /broken" test "$(pp_fixture_hits /broken)" -ge 1
sleep 3
pp_shot "22-loaded-tab-recovered-toolbar-reload"
pp_note "PASS 5a: first-load failure, navigation failure, native and toolbar Reload recovery"
