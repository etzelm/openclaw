#!/usr/bin/env bash
# FW-9 (#183929): running-app proof that Inspect mode in a Mac (App) tab reports
# the element under the pointer even when the page replaces the DOM methods the
# inspector calls. A job-owned fixture page overrides document.elementFromPoint
# (returns a detached <button id="spoofed">) and
# Element.prototype.getBoundingClientRect (returns a 180x36 box at the top left),
# and beacons /saw-inspection to the fixture the first time either one runs.
# The Browser panel, the App tab and Inspect are opened through accessibility
# presses and value sets (synthetic clicks and keystrokes did not reach the app
# on the hosted runner). Only the hover is a pointer event: in a native tab,
# Inspect hides the WKWebView behind a snapshot and the Control UI overlay turns
# pointermove into the app's native inspect(x, y) call, so the pointer is what
# is under test and has no accessibility equivalent.
# head: tooltip names the real element, no beacon. base: the page's fake element
# and a beacon (the bug), logged as BASE.
source "$(dirname "$0")/lib/common.sh"
source "$(dirname "$0")/lib/browser.sh"
trap pp_cleanup EXIT

SPOOF_PORT=$((PP_FIXTURE_PORT + 9))
SPOOF_HITS="$OUT/logs/spoof-hits.jsonl"
SPOOF_URL="http://127.0.0.1:$SPOOF_PORT/spoof"

spoof_fixture_start() {
  cat >"$PP_ROOT/spoof-fixture.mjs" <<'JS'
// Loopback page that replaces the DOM methods Inspect uses and reports when
// they run. Usage: node spoof-fixture.mjs <port> <hits.jsonl>
import { appendFileSync } from "node:fs";
import { createServer } from "node:http";

const [port, hitsPath] = [Number(process.argv[2]), process.argv[3]];
const page = `<!doctype html><html><head><meta charset="utf-8"><title>Inspect spoof fixture</title>
<style>
body { margin: 0; font: 20px -apple-system; }
#banner { height: 80px; display: flex; align-items: center; padding: 0 24px; background: #fde68a; }
#real { position: fixed; top: 80px; left: 0; right: 0; bottom: 0; display: flex;
  align-items: center; justify-content: center; background: #bbf7d0; font-size: 32px; }
</style></head><body>
<div id="banner">This page replaces document.elementFromPoint and getBoundingClientRect</div>
<div id="real" aria-label="Real page element">INSPECT TARGET</div>
<script>
(() => {
  const fake = document.createElement("button");
  fake.id = "spoofed";
  fake.setAttribute("aria-label", "Spoofed by page script");
  let told = false;
  const tell = (method) => {
    if (told) return;
    told = true;
    document.title = "PAGE SAW INSPECTION";
    fetch("/saw-inspection?method=" + method, { cache: "no-store" }).catch(() => {});
  };
  document.elementFromPoint = function () {
    tell("elementFromPoint");
    return fake;
  };
  Element.prototype.getBoundingClientRect = function () {
    tell("getBoundingClientRect");
    return new DOMRect(24, 24, 180, 36);
  };
})();
</script></body></html>`;

createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
  if (url.pathname === "/health") {
    res.writeHead(200).end("ok");
    return;
  }
  appendFileSync(
    hitsPath,
    `${JSON.stringify({ at: new Date().toISOString(), path: url.pathname + url.search, ua: req.headers["user-agent"] ?? "" })}\n`,
  );
  res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
  res.end(url.pathname === "/spoof" ? page : "ok");
}).listen(port, "127.0.0.1", () => console.log(`spoof fixture on 127.0.0.1:${port}`));
JS
  : >"$SPOOF_HITS"
  node "$PP_ROOT/spoof-fixture.mjs" "$SPOOF_PORT" "$SPOOF_HITS" >>"$OUT/logs/spoof-fixture.log" 2>&1 &
  echo $! >"$PP_ROOT/fixture-$SPOOF_PORT.pid"
  pp_wait_for 20 "spoof fixture on $SPOOF_PORT" curl -sf "http://127.0.0.1:$SPOOF_PORT/health"
}

spoof_hits() {
  grep -c "\"path\":\"$1" "$SPOOF_HITS" || true
}

# Re-read on every poll (a "$(...)" argument to pp_wait_for is evaluated once).
spoof_hits_ge() { [[ "$(spoof_hits "$1")" -ge "$2" ]]; }

# Each AX query takes about 25 s on the hosted runner, so AX waits below count
# attempts, not seconds: pp_wait_quiet 4 <ax check> allows roughly 100 s.

# The Browser shortcut belongs to the chat pane (a document keydown listener in
# ui/src/pages/chat/chat-pane-lifecycle.ts); Model Setup does not handle it. A
# Gateway without a default model sends the first run to Model Setup
# (ui/src/pages/model-setup/first-run.ts), so give it a model id to land on the
# default chat. No agent turn runs, so the model is never called.
pp_dashboard_up() {
  pp_gateway_start '{"gateway":{"mode":"local"},"agents":{"defaults":{"model":"openai/gpt-5"}}}'
  pp_app_config
  pp_app_launch --dashboard
  pp_ax wait-window 90 >/dev/null || pp_fail "dashboard window never appeared"
  sleep 10
  pp_shot "00-dashboard"
}

local_network_alert_allow() {
  # The runner raises a Local Network alert ("Allow hosted-compute-... to find
  # devices") over the window center. It keeps key focus, so the Browser
  # shortcut and the first HID click never reach the app. The owning process
  # varies, so try the usual owners, then any process with an Allow button.
  # Polls a few times because the alert can appear late. Logged either way.
  local attempt r
  for attempt in 1 2 3; do
    r="$(osascript 2>&1 <<'OSA'
tell application "System Events"
  set owners to {"UserNotificationCenter", "CoreServicesUIAgent"}
  repeat with p in (every process)
    set end of owners to (name of p)
  end repeat
  repeat with n in owners
    try
      with timeout of 3 seconds
        tell process (n as text)
          repeat with w in windows
            if exists button "Allow" of w then
              click button "Allow" of w
              return "clicked Allow in " & (n as text)
            else if exists button "Allow" of group 1 of w then
              click button "Allow" of group 1 of w
              return "clicked Allow in " & (n as text) & " (group)"
            end if
          end repeat
        end tell
      end timeout
    end try
  end repeat
  return "none"
end tell
OSA
)"
    pp_note "local network alert (attempt $attempt): $r"
    [[ "$r" == clicked* ]] && { sleep 1; return 0; }
    sleep 5
  done
}

pp_browser_panel_open() {
  pp_app_activate
  if ! pp_wait_quiet 3 pp_ax exists AXButton "Panels" web; then
    pp_note "chat pane not shown; leaving the current page"
    pp_ax press "*" "Back to app" web >/dev/null || pp_note "no Back to app control"
    pp_wait_quiet 3 pp_ax exists AXButton "Panels" web || {
      pp_ax dump "$OUT/logs/ax-no-chat.json" >/dev/null || true
      pp_fail "chat pane never appeared (see logs/ax-no-chat.json)"
    }
  fi
  # Same route as mac/proof-5: the Cmd+Option+Shift+U shortcut cannot match
  # (with Option held resolveAsciiShortcutKey gets a non-ASCII key and returns
  # null) and a coordinate click on Panels left the launcher closed in 5b, so
  # press Panels and Browser through accessibility.
  local_network_alert_allow
  pp_ax press AXButton "Panels" web >/dev/null || pp_fail "Panels button not found"
  if ! pp_wait_quiet 3 pp_ax exists AXButton "Browser" web; then
    pp_ax dump "$OUT/logs/ax-panels.json" >/dev/null || true
    pp_fail "Browser entry not found in Panels (see logs/ax-panels.json)"
  fi
  pp_note "Panels launcher open"
  pp_ax press AXButton "Browser" web >/dev/null || pp_fail "Browser entry could not be pressed"
  pp_wait_quiet 4 pp_ax exists AXTextField "$PP_ADDRESS_LABEL" web || {
    pp_ax dump "$OUT/logs/ax-browser-panel.json" >/dev/null || true
    pp_fail "Browser panel did not open (see logs/ax-browser-panel.json)"
  }
  sleep 2
  pp_shot "01-browser-panel"
}

ax9_build() {
  # Exact-label presses over several roles in one tree walk (each walk takes
  # about 25 s on the runner), AX value sets, window raise, multi-text lookup.
  cat >"$PP_ROOT/ax9.js" <<'JS'
// Usage: osascript -l JavaScript ax9.js <bundle-id> <verb> [args...]
//   press <role,role...> <label> [web|native]       AXPress the first element whose
//                                                   title/description/name equals <label>
//   set-value <role> <label> <value> [web|native]   focus the match, set AXValue, print it
//   raise                                           frontmost, AXRaise and AXMain on window 1
//   find-any <role> <scope> <needle>...             print each needle found (substring)
function run(argv) {
  const [bundleId, verb, ...rest] = argv;
  const procs = Application("System Events").processes.whose({ bundleIdentifier: bundleId });
  if (procs.length === 0) throw new Error(`process ${bundleId} not running`);
  const proc = procs[0];
  const safe = (fn) => {
    try {
      return fn();
    } catch (_) {
      return null;
    }
  };
  const attr = (el, name) => safe(() => el.attributes.byName(name).value());
  const strings = (v) => v.filter((s) => typeof s === "string" && s.length > 0);
  const labels = (el) =>
    strings([attr(el, "AXTitle"), attr(el, "AXDescription"), safe(() => el.name())]).map((s) =>
      s.trim().toLowerCase(),
    );
  const texts = (el) =>
    strings([attr(el, "AXTitle"), attr(el, "AXDescription"), attr(el, "AXValue"), attr(el, "AXHelp"), safe(() => el.name())]);
  function* walk(el, depth, inWeb) {
    if (depth > 40) return;
    const web = inWeb || attr(el, "AXRole") === "AXWebArea";
    yield [el, inWeb];
    for (const kid of safe(() => el.uiElements()) || []) yield* walk(kid, depth + 1, web);
  }
  function* scoped(scope) {
    for (const win of proc.windows()) {
      for (const [el, inWeb] of walk(win, 0, false)) {
        if ((scope === "web" && !inWeb) || (scope === "native" && inWeb)) continue;
        yield el;
      }
    }
  }
  function find(roles, label, scope) {
    const want = label.trim().toLowerCase();
    for (const el of scoped(scope)) {
      if (roles.includes(attr(el, "AXRole")) && labels(el).includes(want)) return el;
    }
    return null;
  }
  switch (verb) {
    case "press": {
      const el = find(rest[0].split(","), rest[1], rest[2]);
      if (!el) throw new Error(`no ${rest[0]} labelled ${rest[1]}`);
      el.actions.byName("AXPress").perform();
      return `pressed ${attr(el, "AXRole")} ${rest[1]}`;
    }
    case "set-value": {
      const el = find([rest[0]], rest[1], rest[3]);
      if (!el) throw new Error(`no ${rest[0]} labelled ${rest[1]}`);
      safe(() => (el.attributes.byName("AXFocused").value = true));
      delay(0.5);
      if (safe(() => (el.value = rest[2])) === null) el.attributes.byName("AXValue").value = rest[2];
      delay(0.5);
      return `value now ${attr(el, "AXValue")}`;
    }
    case "raise": {
      proc.frontmost = true;
      const win = proc.windows()[0];
      safe(() => win.actions.byName("AXRaise").perform());
      safe(() => (win.attributes.byName("AXMain").value = true));
      return `frontmost=${proc.frontmost()} main=${attr(win, "AXMain")}`;
    }
    case "find-any": {
      const [role, scope, ...needles] = rest;
      const found = new Set();
      for (const el of scoped(scope)) {
        if (role !== "*" && attr(el, "AXRole") !== role) continue;
        const all = texts(el).join("\n").toLowerCase();
        for (const n of needles) if (all.includes(n.toLowerCase())) found.add(n);
        if (found.size === needles.length) break;
      }
      return [...found].join("\n");
    }
    default:
      throw new Error(`unknown verb ${verb}`);
  }
}
JS
}

ax9() {
  osascript -l JavaScript "$PP_ROOT/ax9.js" "$PP_BUNDLE_ID" "$@"
}

pointer_build() {
  # Pointer moves only (no click): Inspect follows pointermove on the overlay.
  # Usage: pointer <x> <y> hid | pointer <x> <y> pid <pid> <window-number>
  # "hid" posts at the HID event tap (what a mouse does); "pid" posts into the
  # app's event queue with the target window set, for when the window server
  # does not route HID events to the app. Prints post-event access and where
  # the system cursor ended, so the log shows whether the moves were accepted.
  cat >"$PP_ROOT/pointer.swift" <<'SWIFT'
import CoreGraphics
import Foundation

let args = Array(CommandLine.arguments.dropFirst())
guard args.count >= 3, let x = Double(args[0]), let y = Double(args[1]) else { exit(2) }
let mode = args[2]
let pid = args.count > 3 ? pid_t(args[3]) ?? 0 : 0
let window = args.count > 4 ? Int64(args[4]) ?? 0 : 0
guard mode == "hid" || (mode == "pid" && pid > 0) else { exit(2) }
let source = CGEventSource(stateID: .hidSystemState)
// Enter from outside the target so the overlay sees pointerenter, then settle.
for (dx, dy) in [(-160.0, -80.0), (-80, -40), (-40, -20), (-12, -6), (-4, -2), (0, 0)] {
    let point = CGPoint(x: x + dx, y: y + dy)
    guard let event = CGEvent(mouseEventSource: source, mouseType: .mouseMoved,
                              mouseCursorPosition: point, mouseButton: .left) else { exit(1) }
    if mode == "pid" {
        if window > 0 {
            event.setIntegerValueField(.mouseEventWindowUnderMousePointer, value: window)
            event.setIntegerValueField(.mouseEventWindowUnderMousePointerThatCanHandleThisEvent, value: window)
        }
        event.postToPid(pid)
    } else {
        event.post(tap: .cghidEventTap)
    }
    usleep(150_000)
}
let cursor = CGEvent(source: nil)?.location ?? .zero
print("pointer \(mode): postEventAccess=\(CGPreflightPostEventAccess()) target=(\(x), \(y)) cursor=(\(cursor.x), \(cursor.y))")
SWIFT
  swiftc -O -o "$PP_BIN/pointer" "$PP_ROOT/pointer.swift"
}

browser_go_ax() {
  # The address field commits only on an Enter keydown or the Go button, which
  # appears once urlDraft differs from the tab (browser-panel-toolbar.tsx).
  # Set the value through accessibility (WebKit fires input, which updates
  # urlDraft), then press Go.
  local r
  r="$(ax9 set-value AXTextField "Page address" "$1" web 2>&1)" || r="failed: $r"
  pp_note "address field set through AX: $r"
  if r="$(ax9 press AXButton "Go" web 2>&1)"; then
    pp_note "navigate $1 ($r)"
  else
    pp_note "Go button not pressed ($r)"
  fi
}

browser_go_typed() {
  # Fallback: focus the field through AX, then type and press Return.
  pp_ax press AXTextField "$PP_ADDRESS_LABEL" web >/dev/null || true
  sleep 0.5
  osascript -e 'tell application "System Events" to keystroke "a" using command down'
  pp_type "$1"
  pp_note "navigate $1 (typed)"
}

actions_menu_press() {
  # actions_menu_press <item>: Browser actions > <item>, both through AXPress.
  # The trigger is a <button aria-haspopup="menu">; the group around it has the
  # same label, so match button roles only.
  local r
  r="$(ax9 press AXPopUpButton,AXMenuButton,AXButton "Browser actions" web 2>&1)" || {
    pp_ax dump "$OUT/logs/ax-actions-menu.json" >/dev/null || true
    pp_fail "Browser actions button not pressed: $r (see logs/ax-actions-menu.json)"
  }
  pp_note "$r"
  sleep 1
  r="$(ax9 press AXMenuItem,AXMenuItemCheckbox,AXButton "$1" web 2>&1)" || {
    pp_ax dump "$OUT/logs/ax-actions-menu.json" >/dev/null || true
    pp_fail "menu item $1 not pressed: $r (see logs/ax-actions-menu.json)"
  }
  pp_note "$r"
}

INSPECT_NEEDLES=("Real page element" "Spoofed by page script")
inspect_result() {
  # Prints the inspected names visible in the Control UI (empty when none).
  ax9 find-any "*" web "${INSPECT_NEEDLES[@]}" 2>/dev/null || true
}

hover_target() {
  # hover_target <x> <y>: pointer moves over the page target; sets HOVER_ROUTE
  # and INSPECTED. Each rung is verified by the Inspect result, not assumed.
  local pid wid
  pp_note "raise: $(ax9 raise 2>&1 || true)"
  local_network_alert_allow
  "$PP_BIN/pointer" "$1" "$2" hid | tee -a "$OUT/scenario.log" || pp_note "pointer helper failed (hid)"
  sleep 3
  pp_shot "20-inspect-hover"
  INSPECTED="$(inspect_result)"
  if [[ -n "$INSPECTED" ]] || spoof_hits_ge /saw-inspection 1; then
    HOVER_ROUTE="HID event tap"
    return 0
  fi
  pid="$(pp_app_pid)"
  wid="$("$PP_BIN/window-id" "${PP_WINDOW_OWNER:-OpenClaw}" 2>/dev/null || echo 0)"
  pp_note "no Inspect result after HID moves; posting the moves to the app (pid $pid, window $wid)"
  "$PP_BIN/pointer" "$1" "$2" pid "$pid" "$wid" | tee -a "$OUT/scenario.log" || pp_note "pointer helper failed (pid)"
  sleep 3
  pp_shot "21-inspect-hover-pid"
  INSPECTED="$(inspect_result)"
  if [[ -n "$INSPECTED" ]] || spoof_hits_ge /saw-inspection 1; then
    HOVER_ROUTE="posted to app pid"
    return 0
  fi
  HOVER_ROUTE="none reached the overlay"
  pp_ax dump "$OUT/logs/ax-inspecting.json" >/dev/null || true
  return 1
}

center_of() {
  # center_of <json-frame> -> "cx cy"
  printf '%s' "$1" | sed -nE 's/.*"cx":([0-9.]+).*"cy":([0-9.]+).*/\1 \2/p'
}

pp_identity
pp_build_helpers
pointer_build
ax9_build
pp_record_start
spoof_fixture_start
pp_dashboard_up
pp_browser_panel_open

# 1. App tab on the spoofing page, opened from the Browser panel address field.
browser_go_ax "$SPOOF_URL"
if ! pp_wait_quiet 30 spoof_hits_ge /spoof 1; then
  pp_ax dump "$OUT/logs/ax-address.json" >/dev/null || true
  pp_note "no page load after the AX route (see logs/ax-address.json); typing the address"
  browser_go_typed "$SPOOF_URL"
  pp_wait_for 60 "load of /spoof" spoof_hits_ge /spoof 1
fi
pp_wait_quiet 4 pp_ax exists AXStaticText "INSPECT TARGET" web ||
  pp_fail "fixture page text not visible in the app"
sleep 2
ua="$(grep -m1 '"path":"/spoof' "$SPOOF_HITS" | sed -nE 's/.*"ua":"([^"]*)".*/\1/p')"
pp_note "page user agent: $ua"
case "$ua" in
  *Chrome*) pp_fail "page loaded by a Chrome browser tab, not the app's WebKit App tab" ;;
esac
[[ "$(spoof_hits /saw-inspection)" -eq 0 ]] || pp_fail "page reported inspection before Inspect started"
pp_shot "10-app-tab-loaded"
target="$(pp_ax frame AXStaticText "INSPECT TARGET" web)" || pp_fail "page target frame not found"
read -r tx ty <<<"$(center_of "$target")"
[[ -n "$tx" && -n "$ty" ]] || pp_fail "could not read the target center from $target"
pp_note "page target center ($tx, $ty)"

# 2. Inspect element from the Browser actions menu.
actions_menu_press "Inspect element"
sleep 3
# Inspect in a native tab hides the WKWebView and shows its snapshot, so the
# page text leaves the AX tree once the overlay is up.
if pp_ax exists AXStaticText "INSPECT TARGET" web >/dev/null 2>&1; then
  pp_note "inspect requested; page text still in the AX tree (snapshot overlay not confirmed)"
else
  pp_note "inspect mode on: native page hidden behind the snapshot overlay"
fi
pp_shot "15-inspect-mode"

# 3. Pointer over the page target; the overlay asks the app to inspect there.
HOVER_ROUTE="" INSPECTED=""
hover_target "$tx" "$ty" || true

real=0 spoofed=0
grep -qx "Real page element" <<<"$INSPECTED" && real=1
grep -qx "Spoofed by page script" <<<"$INSPECTED" && spoofed=1
beacons="$(spoof_hits /saw-inspection)"
pp_note "hover route: $HOVER_ROUTE; tooltip real=$real spoofed=$spoofed; page beacons=$beacons"
grep '"path":"/saw-inspection' "$SPOOF_HITS" >>"$OUT/scenario.log" || true

# 4. Leave Inspect (choosing it again toggles it off); the tab title shows
# whether the page saw it (base renames it).
ax9 press AXPopUpButton,AXMenuButton,AXButton "Browser actions" web >/dev/null 2>&1 && sleep 1 &&
  ax9 press AXMenuItem,AXMenuItemCheckbox,AXButton "Inspect element" web >/dev/null 2>&1 ||
  pp_note "could not leave Inspect through the menu"
sleep 2
pp_shot "30-after-inspect"

{
  echo "### FW-9 Inspect in an App tab ($VARIANT, $(git -C "$SRC" rev-parse --short=12 HEAD))"
  echo
  echo "| check | result |"
  echo "|---|---|"
  echo "| tooltip names the real element (Real page element) | $real |"
  echo "| tooltip names the page's fake element (Spoofed by page script) | $spoofed |"
  echo "| page saw the inspection (/saw-inspection beacons) | $beacons |"
  echo "| pointer route that reached the overlay | $HOVER_ROUTE |"
} >"$OUT/summary.md"

if [[ "$VARIANT" == "head" ]]; then
  [[ "$beacons" -eq 0 ]] || pp_fail "page overrides ran during Inspect ($beacons beacons)"
  [[ "$spoofed" -eq 0 ]] || pp_fail "Inspect showed the page's fake element"
  [[ -n "$INSPECTED" ]] ||
    pp_fail "no Inspect result: pointer moves did not reach the overlay (see pointer lines, logs/ax-inspecting.json)"
  [[ "$real" -eq 1 ]] || pp_fail "Inspect tooltip for the real element not found"
  pp_note "PASS 9 head: Inspect showed the real element, page overrides never ran"
elif [[ "$beacons" -ge 1 || "$spoofed" -eq 1 ]]; then
  pp_note "BASE reproduces: page overrides ran during Inspect (beacons=$beacons, spoofed=$spoofed)"
elif [[ -z "$INSPECTED" ]]; then
  pp_fail "BASE inconclusive: pointer moves did not reach the overlay (see pointer lines, logs/ax-inspecting.json)"
else
  pp_note "BASE did not reproduce (real=$real); see logs/ax-inspecting.json and shots"
fi
