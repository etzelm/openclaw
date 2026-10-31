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

# Nothing moved DOM focus into the web address field on the hosted runner (see
# 5a.sh); Browser actions > New browser tab focuses it from the page itself.
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

# WebContent processes are XPC services parented to launchd. The kernel's
# responsibility record ties each one to the app that launched it, so only the
# PR build's pages are terminated; a daily OpenClaw or Safari on a local rerun
# is never touched.
pp_build_responsible() {
  cat >"$PP_ROOT/responsible.swift" <<'SWIFT'
// responsible <pid>...: prints "<pid> <responsible-pid>" for each pid.
import Darwin
typealias ResponsibleFn = @convention(c) (pid_t) -> pid_t
guard let sym = dlsym(UnsafeMutableRawPointer(bitPattern: -2), "responsibility_get_pid_responsible_for_pid") else {
  fputs("responsibility_get_pid_responsible_for_pid unavailable\n", stderr)
  exit(2)
}
let responsible = unsafeBitCast(sym, to: ResponsibleFn.self)
for arg in CommandLine.arguments.dropFirst() {
  if let pid = pid_t(arg) { print("\(pid) \(responsible(pid))") }
}
SWIFT
  swiftc -O -o "$PP_BIN/responsible" "$PP_ROOT/responsible.swift"
}

pp_webcontent_pids() {
  # The PR build's WebContent pids, lexical order for comm(1).
  local app owner pids
  app="$(pp_app_pid)"
  [[ -n "$app" ]] || return 0
  owner="$("$PP_BIN/responsible" "$app" | awk '{print $2}')"
  [[ -n "$owner" && "$owner" -gt 0 ]] || pp_fail "no responsibility record for the PR build (pid $app)"
  pids="$(pgrep -f 'com.apple.WebKit.WebContent' || true)"
  [[ -n "$pids" ]] || return 0
  # shellcheck disable=SC2086
  "$PP_BIN/responsible" $pids | awk -v o="$owner" '$2 == o {print $1}' | sort
}

terminate_new_webcontent() {
  # Kills every PR-build WebContent process started after the baseline (the
  # tab's page, plus any prewarmed spare), as a crash would.
  local pids pid
  pids="$(comm -13 "$BASELINE" <(pp_webcontent_pids))"
  [[ -n "$pids" ]] || pp_fail "no new WebContent process of the PR build to terminate"
  for pid in $pids; do
    kill -9 "$pid"
    pp_note "terminated WebContent pid $pid"
  done
}

BASE="http://127.0.0.1:$PP_FIXTURE_PORT"
BASELINE="$PP_ROOT/webcontent-baseline.txt"
SETTLED="stopped repeatedly" # "This page stopped repeatedly", the exhausted-budget view

terminate_and_count() {
  # terminate_and_count <path> <label>: one termination, then report loads.
  terminate_new_webcontent
  sleep 5
  pp_note "$2: loads of $1 = $(pp_fixture_hits "$1")"
}

# The failure view is an AppKit subview of the tab's WKWebView, which WebKit
# keeps out of the accessibility tree; read it from the window instead.
settled_shown() { pp_screen_text "$SETTLED" >/dev/null; }

pp_identity
pp_build_helpers
pp_build_responsible
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
pp_webcontent_pids >"$BASELINE"
pp_note "baseline PR-build WebContent pids: $(tr '\n' ' ' <"$BASELINE")"

# 1. Budget of two automatic reloads, then the settled failure view.
pp_browser_new_tab_go "$BASE/page/crash"
pp_wait_for 20 "first load" hits_ge /page/crash 1
sleep 2
pp_shot "10-loaded"
terminate_and_count /page/crash "termination 1"
terminate_and_count /page/crash "termination 2"
settled_shown && pp_fail "failure view shown while the budget had reloads left"
terminate_and_count /page/crash "termination 3"
loads="$(pp_fixture_hits /page/crash)"
[[ "$loads" -eq 3 ]] || pp_fail "expected 3 loads (1 + 2 automatic reloads), saw $loads"
pp_wait_screen_text 10 "$SETTLED" >"$OUT/logs/settled-view-crash.txt" ||
  pp_fail "settled failure view missing after the third termination"
pp_screen_text "Choose Reload" >>"$OUT/logs/settled-view-crash.txt" || true
pp_shot "11-settled-failure-view"
sleep 8
[[ "$(pp_fixture_hits /page/crash)" -eq 3 ]] || pp_fail "tab kept reloading after the budget was spent"

# 2. Reload recovers and restores the budget. The toolbar Reload (Control UI
# chrome, pressed through accessibility) reaches the same native reload.
pp_ax press AXButton "Reload" web >/dev/null || pp_fail "toolbar Reload button not found"
pp_wait_for 20 "manual reload" hits_ge /page/crash 4
pp_wait_screen_text_gone 10 "$SETTLED" || pp_fail "failure view still shown after Reload"
sleep 2
pp_shot "12-reload-recovered"
terminate_and_count /page/crash "termination after Reload"
[[ "$(pp_fixture_hits /page/crash)" -eq 5 ]] || pp_fail "Reload did not restore the automatic budget"
settled_shown && pp_fail "failure view shown after a restored-budget reload"
pp_shot "13-budget-restored"

# 3. Native menu Back resets the budget on a history move. Every fixture page
# links to /page/b, so the tab navigates without the address field.
pp_ax press AXLink "to page b" >/dev/null || pp_fail "page b link could not be pressed"
pp_wait_for 20 "load of /page/b" hits_ge /page/b 1
sleep 2
# A link press may or may not count as a user navigation (that reset is not
# under test here), so terminate until the budget is spent: 2 or 3 times.
for n in 1 2 3; do
  settled_shown && break
  terminate_and_count /page/b "page b termination $n"
done
pp_wait_screen_text 10 "$SETTLED" >"$OUT/logs/settled-view-page-b.txt" ||
  pp_fail "settled failure view missing on page b"
pp_shot "20-page-b-settled"
before_back="$(pp_fixture_hits /page/crash)"
pp_app_activate
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
pp_app_activate
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
settled_shown && pp_fail "failure view shown while the Forward budget had reloads left"
pp_shot "31-forward-budget-restored"
pp_note "PASS 5b: bounded reloads, settled view, Reload and menu Back/Forward reset"
