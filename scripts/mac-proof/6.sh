#!/usr/bin/env bash
# FW-6 (#185433): authority-chain proof for dashboard HTML widget links.
# Review ask: a real widget click in the shipped macOS dashboard opening the
# link in the default browser, plus synthetic clicks, forged widget requests
# and retired-document requests rejected before the external open.
# Every candidate URL points at the loopback fixture, so the fixture's hit log
# (with the opener's User-Agent) is the final-effect record: only /widget may
# appear, and it must come from the default browser, not the app.
#
# UI that only has to be opened (Local Network alert, Panels, Dashboard) is
# driven by AXPress: synthetic keystrokes and pointer clicks on Panels did
# nothing on the hosted runner (5b, run 40522412293). The widget link click is
# the behavior under test, so it is a HID pointer click first. If no pointer
# click reaches the link, the link is activated by AXPress (WebKit runs it as a
# user gesture, the VoiceOver path) and the PASS line says so.
# The Gateway serves board widgets from its MCP App sandbox on gateway port + 1,
# the shared fixture default: run 40565654500 failed board.get with
# GatewayLockError on 28790 and the dashboard stayed empty.
PP_FIXTURE_PORT="${PP_FIXTURE_PORT:-38790}"
source "$(dirname "$0")/lib/common.sh"
trap pp_cleanup EXIT

pp_click_element() {
  # Overrides the lib version for this scenario. lib screen-frame always adds
  # the nearest AXWebArea origin, but on macOS 27.2 WebKit already reports web
  # elements in screen coordinates (link at 1049,182 inside a web area at
  # 1033,166), so every HID click missed by the web area origin. hit-frame.js
  # tries both readings and keeps the one whose center hit-tests to the element.
  local frame x y
  frame="$(command osascript -l JavaScript "$PP_ROOT/hit-frame.js" "$PP_BUNDLE_ID" "$@" 2>&1)" || {
    pp_note "click target $1 \"$2\" not resolved: $frame"
    return 1
  }
  x="$(printf '%s' "$frame" | sed -nE 's/.*"cx":(-?[0-9.]+).*/\1/p')"
  y="$(printf '%s' "$frame" | sed -nE 's/.*"cy":(-?[0-9.]+).*/\1/p')"
  [[ -n "$x" && -n "$y" ]] || return 1
  pp_note "click target $1 \"$2\": $frame"
  pp_require_front
  "$PP_BIN/click" "$x" "$y"
}

SESSION="agent:main:main"
FIX="http://127.0.0.1:$PP_FIXTURE_PORT"

widget_html() {
  # $1 = version tag. v1 carries the allowed link and every forbidden attempt.
  # #probe records what reached the widget document (read back through AX).
  # No nested frames: board widgets render with blockDescendantFrames
  # (src/gateway/board-sandbox.ts), so the sandbox proxy refuses a document
  # with an iframe, never loads it, and the dashboard shows "A widget resource
  # could not load" (laptop run 2026-10-31).
  cat <<HTML
<div style="font:18px -apple-system;padding:16px">
<p><a id="allowed" target="_blank" href="$FIX/widget">Open widget link</a></p>
<p><a id="synthetic" target="_blank" href="$FIX/synthetic">synthetic target</a></p>
<p id="tag">widget $1</p>
<p id="probe">probe $1 moves:0 down:none click:none</p>
<script>
  var probe = { moves: 0, down: 'none', click: 'none' };
  function showProbe() {
    document.getElementById('probe').textContent =
      'probe $1 moves:' + probe.moves + ' down:' + probe.down + ' click:' + probe.click;
  }
  document.addEventListener('mousemove', function () { probe.moves += 1; showProbe(); }, true);
  document.addEventListener('mousedown', function (e) {
    probe.down = (e.isTrusted ? 'trusted' : 'untrusted') + '-b' + e.button; showProbe();
  }, true);
  setTimeout(function () {
    document.getElementById('synthetic').click();
    document.getElementById('synthetic').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    try { window.open('$FIX/forged-open', '_blank'); } catch (e) {}
    try { parent.postMessage({ type: 'request', method: 'host.open', params: { url: '$FIX/forged-request' } }, '*'); } catch (e) {}
  }, 2000);
  var retire = null;
  document.addEventListener('click', function (e) {
    if (!e.target.closest || !e.target.closest('#allowed')) return;
    var act = navigator.userActivation && navigator.userActivation.isActive ? 'yes' : 'no';
    probe.click = (e.isTrusted ? 'trusted' : 'untrusted') + '-d' + e.detail + '-act-' + act; showProbe();
    // Fires 90 s after the last trusted click on the allowed link; the runner
    // replaces this document with v2 right after the open (each AX query costs
    // ~25 s there), so these requests come from a retired document.
    if ('$1' === 'v1' && e.isTrusted) {
      clearTimeout(retire);
      retire = setTimeout(function () {
        try { window.open('$FIX/retired-open', '_blank'); } catch (e) {}
        try { parent.postMessage({ type: 'request', method: 'host.open', params: { url: '$FIX/retired-request' } }, '*'); } catch (e) {}
      }, 90000);
    }
  }, true);
</script>
</div>
HTML
}

put_widget() {
  local params
  params="$(node -e '
    const [session, html] = process.argv.slice(1);
    process.stdout.write(JSON.stringify({
      sessionKey: session, name: "proof-links", title: "Proof links",
      content: { kind: "html", html },
    }));' "$SESSION" "$(widget_html "$1")")"
  pp_call board.widget.put "$params" >"$OUT/logs/board-widget-put-$1.json" ||
    pp_fail "board.widget.put $1 failed"
  pp_note "widget $1 put"
}

# Fixture counts are re-read on every poll (a "$(...)" argument to pp_wait_for
# would be evaluated once, before the wait starts).
hits_ge() { [[ "$(pp_fixture_hits "$1")" -ge "$2" ]]; }

press_ui() {
  # press_ui <role> <text>: open-only UI (Panels, Dashboard, New tab). Local
  # runs use a HID click: on macOS 27.2 an AXPress on Panels opened the
  # launcher and it closed again within ~0.5 s, while a HID click keeps it
  # open. The hosted runner keeps AXPress (HID clicks did nothing there, 5b).
  if [[ "${PP_LOCAL:-}" == 1 ]]; then
    pp_click_element "$1" "$2" web
  else
    pp_ax press "$1" "$2" web >/dev/null
  fi
}

dismiss_network_alert() {
  # The runner's agent raises "Allow ... to find devices on local networks"
  # over the window center (5b fail-screen.png). Press Allow through AX in
  # whichever process shows it, and log that process; best effort.
  local r
  r="$(osascript -l JavaScript "$PP_ROOT/network-alert.js" "$PP_BUNDLE_ID" 2>&1)" || true
  pp_note "local network alert: ${r:-no answer}"
}

ensure_key_window() {
  # Activate, raise and make the dashboard window main through AX, then log
  # what macOS reports. WebKit drops pointer events for a window that is not
  # key (item-6 evidence/webkit-scenarios-sendEvent-not-delivered.txt).
  local r
  pp_app_activate
  r="$(osascript -l JavaScript "$PP_ROOT/key-window.js" "$PP_BUNDLE_ID" 2>&1)" || true
  pp_note "key window: ${r:-no answer}"
}

open_dashboard_panel() {
  # The panel shortcut (mod+alt+shift+G) never matches on macOS: with Option
  # held the key is non-ASCII and resolveAsciiShortcutKey returns null (5b
  # analysis). Open it from the chat pane's Panels launcher through AX.
  if pp_ax exists AXLink "Open widget link" web >/dev/null 2>&1; then
    pp_note "dashboard panel already shows the widget"
    return 0
  fi
  # A saved layout can reopen the dashboard panel at launch (local profile
  # reruns). Panels toggles the side panel, so pressing it would close it.
  if pp_ax exists AXButton "Close Dashboard" web >/dev/null 2>&1; then
    pp_note "dashboard panel already open (saved layout)"
    pp_wait_quiet 20 pp_ax exists AXLink "Open widget link" web || {
      pp_ax dump "$OUT/logs/ax-dashboard-panel.json" >/dev/null || true
      pp_fail "widget link not shown in the open dashboard panel (see logs/ax-dashboard-panel.json)"
    }
    pp_note "dashboard panel open with the widget"
    return 0
  fi
  if ! pp_wait_quiet 4 pp_ax exists AXButton "Panels" web; then
    pp_ax dump "$OUT/logs/ax-no-chat.json" >/dev/null || true
    pp_fail "chat pane Panels button not found (see logs/ax-no-chat.json)"
  fi
  # Run 41182008780: one Panels press left the chat full width (no side
  # panel, no launcher). Press again once; if the side panel opens on its
  # tab strip without the launcher, open it with New tab (the
  # chat-layout-menu test helper does the same).
  local attempt
  for attempt in 1 2; do
    press_ui AXButton "Panels" || pp_fail "Panels button could not be pressed"
    pp_wait_quiet 4 pp_ax exists AXButton "Dashboard" web && break
    if pp_ax exists AXLink "Open widget link" web >/dev/null 2>&1; then
      pp_note "Panels reopened the dashboard panel"
      return 0
    fi
    if pp_ax exists AXButton "New tab" web >/dev/null 2>&1; then
      press_ui AXButton "New tab" || true
      pp_note "side panel open without launcher: pressed New tab"
      pp_wait_quiet 4 pp_ax exists AXButton "Dashboard" web && break
    fi
    pp_ax dump "$OUT/logs/ax-panels-$attempt.json" >/dev/null || true
    pp_note "Panels press $attempt opened no launcher (see logs/ax-panels-$attempt.json)"
    [[ "$attempt" == 2 ]] && pp_fail "Dashboard entry not found in Panels after 2 presses"
  done
  pp_note "Panels launcher open"
  press_ui AXButton "Dashboard" || pp_fail "Dashboard entry could not be pressed"
  pp_wait_quiet 20 pp_ax exists AXLink "Open widget link" web || {
    pp_ax dump "$OUT/logs/ax-dashboard-panel.json" >/dev/null || true
    pp_fail "widget link not shown after Panels > Dashboard (see logs/ax-dashboard-panel.json)"
  }
  pp_note "dashboard panel open with the widget"
}

probe_state() {
  # probe_state <label>: AX dump plus the widget's own record of input events.
  local file="$OUT/logs/ax-$1.json" line
  pp_ax dump "$file" >/dev/null 2>&1 || true
  line="$(grep -o 'probe v1 moves:[^"]*' "$file" 2>/dev/null | head -1 || true)"
  pp_note "$1: ${line:-probe not in AX tree}"
}

# Default browser app name and the User-Agent token its requests carry (Safari unless set).
BROWSER_APP="${PP_BROWSER_APP:-Safari}"
BROWSER_UA="${PP_BROWSER_UA:-Safari}"

pp_identity
pp_build_helpers
cat >"$PP_ROOT/network-alert.js" <<'JS'
function run(argv) {
  const se = Application("System Events");
  const safe = (fn) => { try { return fn(); } catch (_) { return null; } };
  const first = ["UserNotificationCenter", "CoreServicesUIAgent", "UserNotificationCenterAgent"];
  const skip = ["Dock", "Finder", "Safari", "Google Chrome", "SystemUIServer", "ControlCenter", "WindowManager"];
  const procs = se.processes().map((p) => [p, safe(() => p.name()) || ""]);
  const ordered = procs.filter(([, n]) => first.includes(n))
    .concat(procs.filter(([, n]) => !first.includes(n) && !skip.includes(n)));
  for (const [p, name] of ordered) {
    if (safe(() => p.bundleIdentifier()) === argv[0]) continue;
    const wins = safe(() => p.windows()) || [];
    if (wins.length === 0 || wins.length > 3) continue;
    for (const w of wins) {
      const size = safe(() => w.size()) || [0, 0];
      if (size[0] > 700 || size[1] > 700) continue;
      const all = safe(() => w.entireContents()) || [];
      const text = all.map((e) => [safe(() => e.value()), safe(() => e.name())].join(" ")).join(" ");
      if (!/local network/i.test(text)) continue;
      const allow = all.find((e) => safe(() => e.role()) === "AXButton" && safe(() => e.name()) === "Allow");
      if (!allow) return `alert in ${name}, no Allow button`;
      allow.actions.byName("AXPress").perform();
      return `pressed Allow in ${name}`;
    }
  }
  return "none";
}
JS
cat >"$PP_ROOT/hit-frame.js" <<'JS'
ObjC.import("AppKit");
ObjC.import("ApplicationServices");
// hit-frame.js <bundle-id> <role> <text> [native|web]: screen center of the first
// match, verified by a system-wide hit test (the element or its descendant).
function raw(el, name) {
  const ref = Ref();
  if ($.AXUIElementCopyAttributeValue(el, $(name), ref) !== 0 || !ref[0]) return null;
  return ObjC.castRefToObject(ref[0]);
}
function val(el, name) {
  const v = raw(el, name);
  if (v === null) return null;
  if (v.isKindOfClass($.NSString)) return ObjC.unwrap(v);
  if (v.isKindOfClass($.NSArray)) {
    const out = [];
    for (let i = 0; i < v.count; i++) out.push(v.objectAtIndex(i));
    return out;
  }
  const d = ObjC.unwrap(v.description) || "";
  const m = d.match(/(?:x|w):(-?[\d.]+) (?:y|h):(-?[\d.]+)/);
  return m ? [Number(m[1]), Number(m[2])] : null;
}
function run(argv) {
  const [bundle, role, text, scope] = argv;
  const apps = $.NSRunningApplication.runningApplicationsWithBundleIdentifier($(bundle));
  if (Number(apps.count) !== 1) throw new Error(`expected one ${bundle}, found ${apps.count}`);
  const app = $.AXUIElementCreateApplication(apps.objectAtIndex(0).processIdentifier);
  const needle = (text || "").toLowerCase();
  const texts = (el) => ["AXTitle", "AXDescription", "AXValue", "AXHelp", "AXRoleDescription"]
    .map((n) => val(el, n)).filter((t) => typeof t === "string");
  let hit = null;
  const walk = (el, depth, inWeb, origin) => {
    if (hit || depth > 40) return;
    const r = val(el, "AXRole");
    const isWeb = r === "AXWebArea";
    const o = isWeb ? (val(el, "AXPosition") || [0, 0]) : origin;
    const ok = (scope === "web" && inWeb) || (scope === "native" && !inWeb) || !scope;
    if (ok && (role === "*" || r === role) && texts(el).some((t) => t.toLowerCase().includes(needle))) {
      hit = [el, o];
      return;
    }
    for (const kid of val(el, "AXChildren") || []) walk(kid, depth + 1, inWeb || isWeb, o);
  };
  for (const win of val(app, "AXWindows") || []) walk(win, 0, false, [0, 0]);
  if (!hit) throw new Error(`no ${role} matching ${text}`);
  const [el, origin] = hit;
  const [x, y] = val(el, "AXPosition") || [0, 0];
  const [w, h] = val(el, "AXSize") || [0, 0];
  const system = $.AXUIElementCreateSystemWide();
  const tried = [];
  for (const [mode, sx, sy] of [["screen", x, y], ["web-relative", x + origin[0], y + origin[1]]]) {
    const cx = Math.round(sx + w / 2), cy = Math.round(sy + h / 2);
    const ref = Ref();
    let at = null;
    if ($.AXUIElementCopyElementAtPosition(system, cx, cy, ref) === 0 && ref[0]) at = ObjC.castRefToObject(ref[0]);
    for (let i = 0; at && i < 10; i++) {
      if (at.isEqual(el)) return JSON.stringify({ mode, cx, cy, w, h });
      at = raw(at, "AXParent");
    }
    tried.push(`${mode} ${cx},${cy}`);
  }
  throw new Error(`no center hit-tests to the element (${tried.join("; ")})`);
}
JS
cat >"$PP_ROOT/key-window.js" <<'JS'
function run(argv) {
  const se = Application("System Events");
  const safe = (fn) => { try { return fn(); } catch (e) { return `?(${e.message})`; } };
  const p = se.processes.whose({ bundleIdentifier: argv[0] })[0];
  safe(() => { p.frontmost = true; });
  const wins = p.windows();
  const w = wins.find((x) => safe(() => x.subrole()) === "AXStandardWindow") || wins[0];
  safe(() => w.actions.byName("AXRaise").perform());
  safe(() => { w.attributes.byName("AXMain").value = true; });
  delay(1);
  const front = safe(() => se.processes.whose({ frontmost: true })[0].name());
  const focused = safe(() => p.attributes.byName("AXFocusedWindow").value().name());
  const main = safe(() => w.attributes.byName("AXMain").value());
  return `frontmost=${front} focusedWindow=${focused} main=${main} window=${safe(() => w.name())}`;
}
JS
cat >"$PP_ROOT/event-access.swift" <<'SWIFT'
import ApplicationServices
import CoreGraphics
print("postEvent=\(CGPreflightPostEventAccess()) listenEvent=\(CGPreflightListenEventAccess()) axTrusted=\(AXIsProcessTrusted())")
SWIFT
swiftc -O -o "$PP_BIN/event-access" "$PP_ROOT/event-access.swift" &&
  pp_note "event access for helpers: $("$PP_BIN/event-access" 2>&1)" ||
  pp_note "event access check did not build"
# AX queries cost ~25 s each on the runner; keep the whole scenario on video.
# Local reruns record only the PR build, so they start after its window exists.
[[ "${PP_LOCAL:-}" == 1 ]] || PP_RECORD_MAX=1500 pp_record_start
# A configured default model keeps the Control UI off its first-run Model Setup
# redirect (sessionDefaults.modelConfigured); no model is ever called.
pp_gateway_start '{"agents":{"defaults":{"model":{"primary":"openai/gpt-5.5"}}},"gateway":{"mode":"local"}}'
pp_fixture_start
# A fresh Gateway has no session row, and board.widget.put needs one.
pp_call sessions.create "{\"key\":\"$SESSION\",\"agentId\":\"main\"}" \
  >"$OUT/logs/sessions-create.json" || pp_fail "sessions.create $SESSION failed"
pp_app_config
pp_app_launch --dashboard
pp_ax wait-window 90 >/dev/null || pp_fail "dashboard window never appeared"
# Starting right after wait-window failed with SCStreamError -3812 locally;
# the window is settled after the pause.
sleep 10
[[ "${PP_LOCAL:-}" == 1 ]] && PP_RECORD_MAX=1500 pp_record_start

# 1. Show the session dashboard with the v1 widget.
put_widget v1
dismiss_network_alert
ensure_key_window
open_dashboard_panel
sleep 2
pp_ax dump "$OUT/logs/ax-widget.json" >/dev/null || true
pp_shot "10-widget-visible"

# 2. Forbidden attempts fire on their own timers; none may reach the fixture.
sleep 6
pp_shot "11-after-synthetic-attempts"

# 3. One real click on the allowed link: HID pointer click, a second one if
# the first only keyed the window, then AXPress as the labeled fallback.
dismiss_network_alert
ensure_key_window
probe_state "before-click"
pp_shot "12-before-click"
mechanism=""
for attempt in 1 2; do
  last_click="$(date +%s)"
  if pp_click_element AXLink "Open widget link" web; then
    pp_note "HID click $attempt posted at the link's AX center"
  else
    pp_note "HID click $attempt not posted (link frame not found)"
  fi
  if pp_wait_quiet 20 hits_ge /widget 1; then
    mechanism="HID pointer click $attempt"
    break
  fi
  probe_state "after-hid-$attempt"
  ensure_key_window
done
if [[ -z "$mechanism" ]]; then
  pp_shot "13-no-pointer-open"
  last_click="$(date +%s)"
  pp_ax press AXLink "Open widget link" web >/dev/null || pp_fail "widget link could not be pressed"
  pp_note "no default browser open after the HID clicks; activating the link with AXPress"
  pp_wait_quiet 30 hits_ge /widget 1 && mechanism="AXPress (accessibility activation, no pointer)"
fi
[[ -n "$mechanism" ]] || pp_fail "no default browser hit on /widget after pointer clicks and AXPress"
pp_note "allowed open via: $mechanism"

# 4. Retire the v1 document; its requests fire 90 s after the click and are
# armed only by a trusted click (recorded by the probe before retiring).
probe_state "after-open"
retired_armed=no
grep -q 'probe v1 [^"]*click:trusted' "$OUT/logs/ax-after-open.json" 2>/dev/null && retired_armed=yes
put_widget v2
pp_note "v2 put $(($(date +%s) - last_click))s after the click; retired requests armed: $retired_armed"
sleep 5
PP_WINDOW_OWNER="$BROWSER_APP" pp_shot "20-default-browser"
pp_shot "21-app-after-click"
remaining=$((last_click + 105 - $(date +%s)))
[[ "$remaining" -gt 0 ]] && sleep "$remaining"
pp_shot "30-after-retire"

grep '"path":"/widget"' "$OUT/logs/fixture-hits.jsonl" >"$OUT/logs/allowed-hit.jsonl" || true
forbidden=0
for path in /synthetic /forged-open /forged-request /retired-open /retired-request; do
  n="$(pp_fixture_hits "$path")"
  pp_note "final-effect hits $path = $n"
  forbidden=$((forbidden + n))
done
pp_note "allowed hit opener: $(head -1 "$OUT/logs/allowed-hit.jsonl")"
grep -q "$BROWSER_UA" "$OUT/logs/allowed-hit.jsonl" || pp_fail "/widget was not opened by the default browser"
[[ "$forbidden" -eq 0 ]] || pp_fail "$forbidden forbidden request(s) reached an external open"
pp_note "PASS 6 ($mechanism): the click opened the default browser; synthetic, forged and retired (armed: $retired_armed) requests produced no open"
