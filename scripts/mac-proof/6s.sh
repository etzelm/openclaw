#!/usr/bin/env bash
# FW-6 (#185433) negative leg 6s: a stolen bridge port plus a click OUTSIDE the widget
# (round 7), then one click INSIDE it while the widget keeps sending (round 8): a
# gesture in the widget may open one link, and the widget cannot reuse it.
# Generated from 6.sh (fork mac/proof-6b 6ec6e29bb31); header kept for context:
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
  # pp_require_front exists only in the local (proof-5) lib.
  if declare -F pp_require_front >/dev/null; then pp_require_front; fi
  "$PP_BIN/click" "$x" "$y"
}

SESSION="agent:main:main"
FIX="http://127.0.0.1:$PP_FIXTURE_PORT"

widget_html() {
  # Stolen-port widget (round 7). Overrides MessageEvent.prototype.data to take
  # the wrapper's private bridge port, as against the 7bdf01c0b32 wrapper
  # (src/canvas/wrap.ts:132 there), then sends host.open for /stolen through
  # that port every 300 ms until one is accepted. #probe shows what it got.
  cat <<HTML
<div style="font:18px -apple-system;padding:16px">
<p><a id="allowed" target="_blank" href="$FIX/widget">Open widget link</a></p>
<p id="inside">Inside target</p>
<p id="probe">probe $1 moves:0 down:none port:no ticket:none sent:0 oks:0 last:none</p>
<script>
  var st = { moves: 0, down: 'none', port: null, ticket: null, sent: 0, oks: 0, last: 'none' };
  function show() {
    document.getElementById('probe').textContent = 'probe $1 moves:' + st.moves + ' down:' + st.down +
      ' port:' + (st.port ? 'yes' : 'no') + ' ticket:' + (st.ticket ? 'yes' : 'none') +
      ' sent:' + st.sent + ' oks:' + st.oks + ' last:' + st.last;
  }
  var d = Object.getOwnPropertyDescriptor(MessageEvent.prototype, 'data');
  Object.defineProperty(MessageEvent.prototype, 'data', { configurable: true, get: function () {
    var v = d.get.call(this);
    try {
      if (v && v.type === 'openclaw:widget-host-init' && this.target && this.target.postMessage) {
        st.port = this.target; st.ticket = v.ticket; show();
      }
      if (v && v.type === 'openclaw:widget-bridge-response' && String(v.id).indexOf('stolen-') === 0) {
        st.last = v.ok ? 'ok' : 'err:' + v.error; if (v.ok) st.oks += 1; show();
      }
    } catch (e) {}
    return v;
  } });
  document.addEventListener('mousemove', function () { st.moves += 1; show(); }, true);
  document.addEventListener('mousedown', function (e) {
    st.down = (e.isTrusted ? 'trusted' : 'untrusted') + '-b' + e.button; show();
  }, true);
  // Start 12 s after load, so the activation from opening the panel has
  // expired and only the runner's later outside input can supply one.
  var startAt = Date.now() + 12000;
  setInterval(function () {
    // Never stops: every accepted open is counted, and later sends test reuse.
    if (!st.port || !st.ticket || Date.now() < startAt) return;
    st.sent += 1; show();
    st.port.postMessage({ type: 'openclaw:widget-bridge-request', id: 'stolen-' + st.sent,
      method: 'host.open', params: { url: '$FIX/stolen' }, ticket: st.ticket });
  }, 300);
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
  line="$(grep -o 'probe s1 moves:[^"]*' "$file" 2>/dev/null | head -1 || true)"
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

# ---- 6s main flow ----
# SEED_SRC builds the stored widget (its wrapper bytes are fixed at put time);
# SRC serves it afterwards from the same state dir, as after an upgrade.
: "${SEED_SRC:?SEED_SRC is required}"
pp_note "seed source $(git -C "$SEED_SRC" rev-parse HEAD); serving source $(git -C "$SRC" rev-parse HEAD)"
pp_gateway_resume() {
  pp_cli gateway run --port "$PP_GATEWAY_PORT" --bind loopback --auth token \
    --token "$PP_TOKEN" --allow-unconfigured --verbose >>"$OUT/logs/gateway.log" 2>&1 &
  echo $! >"$PP_ROOT/gateway.pid"
  pp_wait_for 120 "Gateway health on 127.0.0.1:$PP_GATEWAY_PORT" \
    pp_cli gateway health --url "ws://127.0.0.1:$PP_GATEWAY_PORT" --token "$PP_TOKEN"
  pp_note "gateway resumed from $(git -C "$SRC" rev-parse --short HEAD) (pid $(cat "$PP_ROOT/gateway.pid"))"
}
SERVE_SRC="$SRC"
SRC="$SEED_SRC"
pp_gateway_start '{"agents":{"defaults":{"model":{"primary":"openai/gpt-5.5"}}},"gateway":{"mode":"local"}}'
pp_fixture_start
pp_call sessions.create "{\"key\":\"$SESSION\",\"agentId\":\"main\"}" \
  >"$OUT/logs/sessions-create.json" || pp_fail "sessions.create $SESSION failed"
put_widget s1
pp_gateway_stop
SRC="$SERVE_SRC"
pp_gateway_resume
pp_app_config
pp_app_launch --dashboard
pp_ax wait-window 90 >/dev/null || pp_fail "dashboard window never appeared"
sleep 10
[[ "${PP_LOCAL:-}" == 1 ]] && PP_RECORD_MAX=900 pp_record_start
dismiss_network_alert
ensure_key_window
open_dashboard_panel
sleep 3
probe_state "stolen-loaded"
pp_shot "40-stolen-widget"
grep -q 'probe s1 [^"]*port:yes' "$OUT/logs/ax-stolen-loaded.json" 2>/dev/null && armed=yes || armed=no
pp_note "stolen port armed: $armed"
# The widget starts sending 12 s after load; by then the activation from the
# panel clicks has expired, so requests flow with no activation at all.
sleep 14
pp_note "before outside click: hits /stolen = $(pp_fixture_hits /stolen)"
# Real HID input OUTSIDE the widget frame: a click on chat-pane text, then a
# click in the chat composer plus one keystroke (never sent).
ensure_key_window
pp_click_element AXStaticText "Type a message below" web ||
  pp_fail "outside-widget click target not found"
pp_note "outside click 1 posted on chat text"
sleep 6
pp_note "after outside click 1: hits /stolen = $(pp_fixture_hits /stolen)"
# One HID keystroke with focus in the dashboard document (not the widget).
if [[ -x "${PP_KEY_TOOL:-}" ]]; then
  "$PP_KEY_TOOL" key
  pp_note "outside keystroke posted (focus stays in the dashboard after click 1)"
else
  pp_note "no key tool; skipped the keystroke"
fi
sleep 6
probe_state "after-outside-click"
pp_shot "41-after-outside-click"
grep -q 'probe s1 [^"]*down:none' "$OUT/logs/ax-after-outside-click.json" 2>/dev/null &&
  pp_note "widget saw no mousedown: the click landed outside it" ||
  pp_note "warning: widget recorded a mousedown (click may have landed inside)"
PP_WINDOW_OWNER="$BROWSER_APP" pp_shot "42-default-browser"
n="$(pp_fixture_hits /stolen)"
pp_note "final-effect hits /stolen = $n (armed: $armed)"
[[ "$armed" == yes ]] || pp_fail "stolen port never armed; leg inconclusive"
if [[ "$n" -eq 0 ]]; then
  pp_note "RESULT 6s: no open: stolen-port requests after a click outside the widget were refused"
else
  pp_note "RESULT 6s: OPENED: $n stolen-port request(s) reached the default browser after a click outside the widget"
fi

# Round 8: one real click INSIDE the stolen widget (on plain text, not a
# link). The widget keeps sending host.open every 300 ms through the stolen
# port for the whole 5 s activation window; at most one may open.
ensure_key_window
before_inside="$n"
pp_click_element AXStaticText "Inside target" web || pp_fail "inside-widget click target not found"
pp_note "inside click posted on the widget's plain text (not a link)"
sleep 8
probe_state "after-inside-click"
pp_shot "43-after-inside-click"
grep -q 'probe s1 [^"]*down:trusted' "$OUT/logs/ax-after-inside-click.json" 2>/dev/null &&
  pp_note "widget saw the trusted mousedown: the click landed inside it" ||
  pp_note "warning: widget recorded no trusted mousedown; the inside leg is inconclusive"
inside=$(( $(pp_fixture_hits /stolen) - before_inside ))
pp_note "final-effect hits /stolen after the inside click = $inside (at $(grep '"path":"/stolen' "$OUT/logs/fixture-hits.jsonl" 2>/dev/null | sed -nE 's/.*"at":"[^T]*T([^"]*)".*/\1/p' | tr '\n' ' '))"
pp_note "RESULT 6s-inside: $inside open(s) from one click inside the widget while it kept sending"
