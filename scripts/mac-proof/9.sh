#!/usr/bin/env bash
# FW-9 (#183929): running-app proof that Inspect mode in a Mac (App) tab reports
# the element under the pointer even when the page replaces the DOM methods the
# inspector calls. A job-owned fixture page overrides document.elementFromPoint
# (returns a detached <button id="spoofed">) and
# Element.prototype.getBoundingClientRect (returns a 180x36 box at the top left),
# and beacons /saw-inspection to the fixture the first time either one runs.
# The App tab is opened and Inspect is started through the Browser panel UI,
# with real HID pointer moves over the page.
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
    pp_click_element "*" "Back to app" web || osascript -e 'tell application "System Events" to key code 53'
    pp_wait_quiet 3 pp_ax exists AXButton "Panels" web || {
      pp_ax dump "$OUT/logs/ax-no-chat.json" >/dev/null || true
      pp_fail "chat pane never appeared (see logs/ax-no-chat.json)"
    }
  fi
  local_network_alert_allow
  pp_app_activate
  osascript -e 'tell application "System Events" to keystroke "u" using {command down, option down, shift down}'
  if ! pp_wait_quiet 3 pp_ax exists AXTextField "$PP_ADDRESS_LABEL" web; then
    pp_note "browser shortcut did not open the panel; using Panels > Browser"
    local_network_alert_allow
    pp_app_activate
    pp_click_element AXButton "Panels" web || pp_fail "Panels button not found"
    sleep 1
    pp_wait_quiet 2 pp_ax exists "*" "Browser" web ||
      pp_click_element AXButton "Panels" web || pp_fail "Panels button not found"
    sleep 1
    pp_click_element "*" "Browser" web || pp_fail "Browser entry not found in Panels"
    pp_wait_quiet 4 pp_ax exists AXTextField "$PP_ADDRESS_LABEL" web || {
      pp_ax dump "$OUT/logs/ax-browser-panel.json" >/dev/null || true
      pp_fail "Browser panel did not open (see logs/ax-browser-panel.json)"
    }
  fi
  sleep 2
  pp_shot "01-browser-panel"
}

pointer_build() {
  # Pointer moves only (no click): Inspect follows pointermove on the overlay.
  cat >"$PP_ROOT/pointer.swift" <<'SWIFT'
import CoreGraphics
import Foundation

let args = CommandLine.arguments.dropFirst().compactMap(Double.init)
guard args.count == 2 else { exit(2) }
let source = CGEventSource(stateID: .hidSystemState)
for offset in [-40.0, -24.0, -12.0, -4.0, 0.0] {
    let point = CGPoint(x: args[0] + offset, y: args[1] + offset / 2)
    guard let event = CGEvent(mouseEventSource: source, mouseType: .mouseMoved,
                              mouseCursorPosition: point, mouseButton: .left) else { exit(1) }
    event.post(tap: .cghidEventTap)
    usleep(150_000)
}
SWIFT
  swiftc -O -o "$PP_BIN/pointer" "$PP_ROOT/pointer.swift"
}

center_of() {
  # center_of <json-frame> -> "cx cy"
  printf '%s' "$1" | sed -nE 's/.*"cx":([0-9.]+).*"cy":([0-9.]+).*/\1 \2/p'
}

pp_identity
pp_build_helpers
pointer_build
pp_record_start
spoof_fixture_start
pp_dashboard_up
pp_browser_panel_open

# 1. App tab on the spoofing page, opened from the Browser panel address field.
pp_browser_go "$SPOOF_URL"
pp_wait_for 60 "load of /spoof" spoof_hits_ge /spoof 1
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
pp_click_element AXButton "Browser actions" web ||
  pp_click_element AXPopUpButton "Browser actions" web ||
  pp_click_element AXMenuButton "Browser actions" web ||
  pp_fail "Browser actions menu button not found"
sleep 1
pp_click_element AXMenuItem "Inspect element" web ||
  pp_click_element "*" "Inspect element" web ||
  pp_fail "Inspect element menu item not found (see logs/ax-fail.json)"
sleep 3
pp_note "inspect mode requested"

# 3. Real pointer over the page; the overlay asks the app to inspect that point.
pp_app_activate
local_network_alert_allow
"$PP_BIN/pointer" "$tx" "$ty"
sleep 2
"$PP_BIN/pointer" "$tx" "$ty"
sleep 3
pp_shot "20-inspect-hover"
pp_wait_quiet 2 pp_ax exists AXStaticText "Focusable" web || {
  pp_note "inspect tooltip not found by AX (see logs/ax-inspecting.json and the shot)"
  pp_ax dump "$OUT/logs/ax-inspecting.json" >/dev/null || true
}

real=0 spoofed=0
pp_ax exists AXStaticText "Real page element" web >/dev/null 2>&1 && real=1
pp_ax exists AXStaticText "Spoofed by page script" web >/dev/null 2>&1 && spoofed=1
beacons="$(spoof_hits /saw-inspection)"
pp_note "tooltip real=$real spoofed=$spoofed; page beacons=$beacons"
grep '"path":"/saw-inspection' "$SPOOF_HITS" >>"$OUT/scenario.log" || true

# 4. Leave Inspect; the tab title shows whether the page saw it (base renames it).
osascript -e 'tell application "System Events" to key code 53'
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
} >"$OUT/summary.md"

if [[ "$VARIANT" == "head" ]]; then
  [[ "$beacons" -eq 0 ]] || pp_fail "page overrides ran during Inspect ($beacons beacons)"
  [[ "$spoofed" -eq 0 ]] || pp_fail "Inspect showed the page's fake element"
  [[ "$real" -eq 1 ]] || pp_fail "Inspect tooltip for the real element not found"
  pp_note "PASS 9 head: Inspect showed the real element, page overrides never ran"
elif [[ "$beacons" -ge 1 || "$spoofed" -eq 1 ]]; then
  pp_note "BASE reproduces: page overrides ran during Inspect (beacons=$beacons, spoofed=$spoofed)"
else
  pp_note "BASE did not reproduce (real=$real); see logs/ax-inspecting.json and shots"
fi
