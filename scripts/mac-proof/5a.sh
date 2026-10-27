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

# HID clicks do not reach the window on the hosted runner: the click on "Page
# address" left keyboard focus in the chat composer, so run 40538887368 sent
# the URL as a chat message and the tab never loaded. Focus the field and
# press buttons through accessibility; keystrokes do reach the focused control.
ax_field() {
  # ax_field <focus|value> <role> <text> [native|web]: focus prints the field's
  # AXFocused after setting it (AXPress fallback); value prints its AXValue.
  osascript -l JavaScript - "$PP_BUNDLE_ID" "$@" <<'JXA'
function run(argv) {
  const [bundleId, verb, role, text, scope] = argv;
  const procs = Application("System Events").processes.whose({ bundleIdentifier: bundleId });
  if (procs.length === 0) throw new Error(`process ${bundleId} not running`);
  const proc = procs[0];
  const safe = (fn) => { try { return fn(); } catch (_) { return null; } };
  const attr = (el, n) => safe(() => el.attributes.byName(n).value());
  const needle = (text || "").toLowerCase();
  const matches = (el) =>
    ["AXTitle", "AXDescription", "AXValue", "AXHelp"].map((n) => attr(el, n)).concat([safe(() => el.name())])
      .some((v) => typeof v === "string" && v.toLowerCase().includes(needle));
  function* walk(el, depth, inWeb) {
    if (depth > 40) return;
    const web = inWeb || attr(el, "AXRole") === "AXWebArea";
    yield [el, inWeb];
    for (const kid of safe(() => el.uiElements()) || []) yield* walk(kid, depth + 1, web);
  }
  let el = null;
  for (const win of proc.windows()) {
    for (const [e, inWeb] of walk(win, 0, false)) {
      if ((scope === "native" && inWeb) || (scope === "web" && !inWeb)) continue;
      if (attr(e, "AXRole") === role && matches(e)) { el = e; break; }
    }
    if (el) break;
  }
  if (!el) throw new Error(`no ${role} matching ${text}`);
  if (verb === "value") return String(attr(el, "AXValue") || "");
  safe(() => { el.attributes.byName("AXFocused").value = true; });
  delay(0.5);
  if (attr(el, "AXFocused") !== true) {
    safe(() => el.actions.byName("AXPress").perform());
    delay(0.5);
  }
  return String(attr(el, "AXFocused") === true);
}
JXA
}

pp_browser_go() {
  # pp_browser_go <url>: AX-focus the address field, type, check, Return.
  local focused value
  focused="$(ax_field focus AXTextField "$PP_ADDRESS_LABEL" web)" ||
    pp_fail "Browser address field not found (label '$PP_ADDRESS_LABEL')"
  if [[ "$focused" != "true" ]]; then
    pp_ax dump "$OUT/logs/ax-address-focus.json" >/dev/null || true
    pp_fail "address field did not take focus (see logs/ax-address-focus.json)"
  fi
  osascript -e 'tell application "System Events" to keystroke "a" using command down'
  osascript -e "tell application \"System Events\" to keystroke \"$1\""
  value="$(ax_field value AXTextField "$PP_ADDRESS_LABEL" web)" || value=""
  if [[ "$value" != *"$1"* ]]; then
    pp_ax dump "$OUT/logs/ax-address-typed.json" >/dev/null || true
    pp_fail "typed URL not in the address field (value '$value'; see logs/ax-address-typed.json)"
  fi
  osascript -e 'tell application "System Events" to key code 36'
  pp_note "navigate $1"
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
pp_ax exists AXStaticText "couldn't be opened" native >/dev/null ||
  pp_fail "native failure view missing after failed first load"
pp_shot "10-new-tab-failed"
pp_ax frame AXTextField "$PP_ADDRESS_LABEL" web >"$OUT/logs/address-after-first-failure.json" || true
pp_ax dump "$OUT/logs/ax-new-tab-failed.json" >/dev/null || true

# 2. Native Reload retries the attempted address once it is reachable.
pp_fixture_start "$LATE_A"
pp_ax press AXButton "Reload" native >/dev/null || pp_fail "native Reload button not found"
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
pp_ax press AXButton "Reload" web >/dev/null || pp_fail "toolbar Reload button not found"
pp_wait_for 20 "retry of /broken" hits_ge /broken 1
sleep 3
pp_shot "22-loaded-tab-recovered-toolbar-reload"
pp_note "PASS 5a: first-load failure, navigation failure, native and toolbar Reload recovery"
