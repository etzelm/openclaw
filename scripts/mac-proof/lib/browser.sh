#!/usr/bin/env bash
# Dashboard Browser helpers shared by the 5A and 5B scenarios. Source after common.sh.

# Accessibility label of the Browser panel address field; override if the
# Control UI labels it differently (the AX dump in logs/ shows the real one).
PP_ADDRESS_LABEL="${PP_ADDRESS_LABEL:-address}"

pp_dashboard_up() {
  # Gateway + fixture + app in remote mode, dashboard window open.
  pp_gateway_start '{"gateway":{"mode":"local"}}'
  pp_fixture_start "$PP_FIXTURE_PORT"
  pp_app_config
  pp_app_launch --dashboard
  pp_ax wait-window 90 >/dev/null || pp_fail "dashboard window never appeared"
  sleep 10
  pp_shot "00-dashboard"
}

pp_browser_panel_open() {
  # ui.command only reaches the requesting Control UI connection, never a CLI
  # caller, so open the panel the way a user does: the Control UI shortcut
  # (mod+alt+shift+U), then the Command Palette entry as a fallback.
  pp_app_activate
  osascript -e 'tell application "System Events" to keystroke "u" using {command down, option down, shift down}'
  if ! pp_wait_quiet 10 pp_ax exists AXTextField "$PP_ADDRESS_LABEL" web; then
    pp_note "browser shortcut did not open the panel; trying the Command Palette"
    pp_ax menu "Command Palette…" >>"$OUT/scenario.log" || pp_fail "Command Palette menu item not found"
    sleep 1
    pp_type "Toggle browser panel"
    pp_wait_quiet 10 pp_ax exists AXTextField "$PP_ADDRESS_LABEL" web ||
      pp_fail "Browser panel did not open (see logs/ax-browser-panel.json)"
  fi
  sleep 2
  pp_ax dump "$OUT/logs/ax-browser-panel.json" >/dev/null || true
  pp_shot "01-browser-panel"
}

pp_browser_go() {
  # pp_browser_go <url>: real click into the address field, type, Return.
  pp_click_element AXTextField "$PP_ADDRESS_LABEL" web ||
    pp_fail "Browser address field not found (label '$PP_ADDRESS_LABEL'; see logs/ax-*.json)"
  sleep 0.5
  osascript -e 'tell application "System Events" to keystroke "a" using command down'
  pp_type "$1"
  pp_note "navigate $1"
}

pp_webcontent_pids() {
  # Lexical order for comm(1).
  pgrep -f 'com.apple.WebKit.WebContent' | sort || true
}

pp_kill_newest_webcontent() {
  # pp_kill_newest_webcontent <baseline-pids-file>: kills the newest WebContent
  # process that was not running at baseline (the tab's page), as a crash would.
  local baseline="$1" pid
  pid="$(comm -13 "$baseline" <(pp_webcontent_pids) | sort -n | tail -1)"
  [[ -n "$pid" ]] || pp_fail "no new WebContent process to terminate"
  kill -9 "$pid"
  pp_note "terminated WebContent pid $pid"
}
