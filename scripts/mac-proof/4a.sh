#!/usr/bin/env bash
# FW-4A (#185435): packaged-app launch-to-hidden-dashboard-preload in remote mode.
# Review ask: launch arming, the hidden load, and the first visible open, with
# a before/after comparison. Run as two matrix entries: VARIANT=base (PR base)
# and VARIANT=head (patched); compare their artifacts.
# Evidence: the app's remote URL points at a loopback logging proxy in front
# of the job Gateway (proxy.mjs below), so every HTTP request and WebSocket
# upgrade the app and its dashboard WebView make is timestamped. The dashboard
# document is the request with Sec-Fetch-Dest: document. The full CoreGraphics
# window list (on and off screen) shows the preloaded window and whether the
# first open put that same window on screen.
# Earlier run 40542122063 showed the page opens its Gateway socket only once
# the window is on screen, so the hidden load is judged by the document
# request, not by a socket or presence row. The page socket time after open is
# reported for both variants.
source "$(dirname "$0")/lib/common.sh"
PP_DONE=0
trap 'proxy_stop; pp_cleanup; [[ "$PP_DONE" == 1 ]] || exit 1' EXIT

PP_PROXY_PORT="${PP_PROXY_PORT:-28791}"
PRELOAD_WAIT=90
SETTLE_AFTER_OPEN=20

now() { python3 -c 'import time; print(f"{time.time():.3f}")'; } # BSD date has no %N

write_proxy() {
  cat >"$PP_ROOT/proxy.mjs" <<'JS'
// Loopback logging proxy for the 4A proof. Forwards every HTTP request and
// WebSocket upgrade unchanged (Host included) to the job Gateway and logs one
// JSON line per request: time, kind, method, path, Sec-Fetch-Dest, whether an
// Origin header was sent. Query values are never logged (they can carry auth).
import http from "node:http";
import net from "node:net";
import fs from "node:fs";

const [listenPort, gatewayPort, logPath] = process.argv.slice(2);
const log = (entry) => fs.appendFileSync(logPath, `${JSON.stringify({ t: Date.now() / 1000, ...entry })}\n`);
const describe = (req) => {
  const url = new URL(req.url, "http://proxy");
  return {
    method: req.method,
    path: url.pathname,
    queryKeys: [...url.searchParams.keys()],
    dest: req.headers["sec-fetch-dest"] ?? null,
    html: /text\/html/.test(req.headers.accept ?? ""),
    origin: req.headers.origin ? "present" : "absent",
    agent: /AppleWebKit/.test(req.headers["user-agent"] ?? "") ? "webkit" : "other",
  };
};

const server = http.createServer((req, res) => {
  log({ kind: "http", ...describe(req) });
  const upstream = http.request(
    { host: "127.0.0.1", port: Number(gatewayPort), method: req.method, path: req.url, headers: req.headers },
    (up) => {
      res.writeHead(up.statusCode ?? 502, up.headers);
      up.pipe(res);
    },
  );
  upstream.on("error", (err) => {
    log({ kind: "error", error: String(err) });
    res.destroy();
  });
  req.pipe(upstream);
});

server.on("upgrade", (req, socket, head) => {
  log({ kind: "upgrade", ...describe(req) });
  const upstream = net.connect(Number(gatewayPort), "127.0.0.1", () => {
    let raw = `${req.method} ${req.url} HTTP/${req.httpVersion}\r\n`;
    for (let i = 0; i < req.rawHeaders.length; i += 2) raw += `${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}\r\n`;
    upstream.write(`${raw}\r\n`);
    if (head?.length) upstream.write(head);
    upstream.pipe(socket);
    socket.pipe(upstream);
  });
  const close = () => {
    upstream.destroy();
    socket.destroy();
  };
  upstream.on("error", close);
  socket.on("error", close);
});

server.listen(Number(listenPort), "127.0.0.1", () => console.log(`proxy 127.0.0.1:${listenPort} -> ${gatewayPort}`));
JS
}

proxy_start() {
  write_proxy
  : >"$OUT/logs/proxy.jsonl"
  node "$PP_ROOT/proxy.mjs" "$PP_PROXY_PORT" "$PP_GATEWAY_PORT" "$OUT/logs/proxy.jsonl" \
    >>"$OUT/logs/proxy.log" 2>&1 &
  echo $! >"$PP_ROOT/proxy.pid"
  pp_wait_for 20 "logging proxy on $PP_PROXY_PORT" nc -z 127.0.0.1 "$PP_PROXY_PORT"
}

proxy_stop() {
  [[ -f "$PP_ROOT/proxy.pid" ]] && kill "$(cat "$PP_ROOT/proxy.pid")" 2>/dev/null || true
  rm -f "$PP_ROOT/proxy.pid"
}

documents() {
  # documents <from> <to>: count of dashboard document requests in [from, to):
  # Sec-Fetch-Dest: document, or a GET accepting HTML when the header is absent.
  node -e '
    const fs = require("fs");
    const [path, from, to] = process.argv.slice(1);
    const rows = fs.readFileSync(path, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
    const n = rows.filter((r) => r.kind === "http" && (r.dest === "document" || (r.dest === null && r.method === "GET" && r.html)) && r.t >= Number(from) && r.t < Number(to)).length;
    process.stdout.write(String(n));' "$OUT/logs/proxy.jsonl" "$1" "$2"
}

first_page_socket() {
  # first_page_socket <from>: seconds from <from> to the first WebSocket upgrade
  # sent with an Origin header (the dashboard page; the app's native sockets
  # send none), or "none".
  node -e '
    const fs = require("fs");
    const [path, from] = process.argv.slice(1);
    const rows = fs.readFileSync(path, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
    const hit = rows.find((r) => r.kind === "upgrade" && r.origin === "present" && r.t >= Number(from));
    process.stdout.write(hit ? (hit.t - Number(from)).toFixed(1) : "none");' "$OUT/logs/proxy.jsonl" "$1"
}

build_window_list() {
  # All layer-0 windows of the app, on and off screen, as JSON lines.
  cat >"$PP_ROOT/window-list.swift" <<'SWIFT'
import CoreGraphics
import Foundation

let owner = CommandLine.arguments.dropFirst().first ?? "OpenClaw"
guard let windows = CGWindowListCopyWindowInfo([.optionAll], kCGNullWindowID) as? [[String: Any]] else {
    exit(1)
}
for window in windows where (window[kCGWindowOwnerName as String] as? String) == owner {
    guard (window[kCGWindowLayer as String] as? Int) == 0 else { continue }
    let bounds = window[kCGWindowBounds as String] as? [String: Double] ?? [:]
    let row: [String: Any] = [
        "id": window[kCGWindowNumber as String] as? Int ?? 0,
        "title": window[kCGWindowName as String] as? String ?? "",
        "onScreen": window[kCGWindowIsOnscreen as String] as? Bool ?? false,
        "width": bounds["Width"] ?? 0,
        "height": bounds["Height"] ?? 0,
    ]
    let data = try JSONSerialization.data(withJSONObject: row, options: [.sortedKeys])
    print(String(decoding: data, as: UTF8.self))
}
SWIFT
  swiftc -O -o "$PP_BIN/window-list" "$PP_ROOT/window-list.swift"
}

windows() {
  # windows <label>: full window list to logs/windows-<label>.jsonl.
  "$PP_BIN/window-list" OpenClaw >"$OUT/logs/windows-$1.jsonl" 2>/dev/null || true
  pp_note "windows $1: $(grep -c '"onScreen":true' "$OUT/logs/windows-$1.jsonl" || true) on screen," \
    "$(grep -c '"onScreen":false' "$OUT/logs/windows-$1.jsonl" || true) off screen"
}

dashboard_window() {
  # dashboard_window <label> <on|off>: id of the titled "OpenClaw" window that
  # is (on) or is not (off) on screen, or empty.
  local want=false
  [[ "$2" == on ]] && want=true
  # No match is a valid answer: under pipefail grep's exit 1 would abort.
  { grep '"title":"OpenClaw"' "$OUT/logs/windows-$1.jsonl" | grep "\"onScreen\":$want" |
    sed -nE 's/.*"id":([0-9]+).*/\1/p' | head -n 1; } || true
}

dismiss_network_alert() {
  # The runner can raise "Allow ... to find devices on local networks" over
  # the window center (5b fail-screen.png). Press Allow through AX; best effort.
  cat >"$PP_ROOT/network-alert.js" <<'JS'
function run(argv) {
  const se = Application("System Events");
  const safe = (fn) => { try { return fn(); } catch (_) { return null; } };
  const first = ["UserNotificationCenter", "CoreServicesUIAgent", "UserNotificationCenterAgent"];
  const skip = ["Dock", "Finder", "Safari", "SystemUIServer", "ControlCenter", "WindowManager"];
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
  local r
  r="$(osascript -l JavaScript "$PP_ROOT/network-alert.js" "$PP_BUNDLE_ID" 2>&1)" || true
  pp_note "local network alert: ${r:-no answer}"
}

pp_identity
pp_build_helpers
build_window_list
pp_record_start
# A Gateway without a default model sends the dashboard to Model Setup; a
# model id lands it on the default chat. No agent turn runs.
pp_gateway_start '{"gateway":{"mode":"local"},"agents":{"defaults":{"model":"openai/gpt-5"}}}'
proxy_start
pp_app_config
# Aim the app (control channel, node, dashboard) at the logging proxy.
sed -i '' "s#ws://127.0.0.1:$PP_GATEWAY_PORT#ws://127.0.0.1:$PP_PROXY_PORT#" "$PP_ROOT/app-state/openclaw.json"
grep -q "ws://127.0.0.1:$PP_PROXY_PORT" "$PP_ROOT/app-state/openclaw.json" ||
  pp_fail "app config does not point at the logging proxy"

# Normal interactive launch (automatic presentation allowed, no --dashboard).
# The patched build arms the preload 2 s after launch and loads once the
# control channel is connected. Wait for a document request, up to
# PRELOAD_WAIT s; the base build is expected to make none.
launch_at="$(now)"
pp_app_launch
doc_at=""
for ((i = 0; i < PRELOAD_WAIT; i++)); do
  if [[ "$(documents "$launch_at" 9999999999)" -ge 1 ]]; then
    doc_at="$(now)"
    break
  fi
  sleep 1
done
pp_note "document requests before any open: $(documents "$launch_at" 9999999999)" \
  "${doc_at:+(first seen $(python3 -c "print(f'{$doc_at - $launch_at:.1f}')") s after launch)}"
# Let the hidden document settle, then dismiss any runner alert.
sleep 10
dismiss_network_alert
windows before-open
visible_before="$(dashboard_window before-open on)"
hidden_before="$(dashboard_window before-open off)"
pp_note "dashboard window before open: on screen=[${visible_before}] off screen=[${hidden_before}]"
screencapture -x "$OUT/shots/10-screen-before-open.png"

# First visible open through the same action as the menu bar item
# (openclaw://dashboard -> AppNavigationActions.openDashboard()).
open_at="$(now)"
open "openclaw://dashboard"
for i in $(seq -w 0 15); do
  wid="$("$PP_BIN/window-id" OpenClaw 2>/dev/null || true)"
  [[ -n "$wid" ]] && screencapture -x -o -l "$wid" "$OUT/shots/20-first-open-frame-$i.png"
  sleep 0.25
done
pp_note "first-open frame burst done (16 frames, 250 ms apart)"
sleep "$SETTLE_AFTER_OPEN"
settled_at="$(now)"
pp_shot "30-dashboard-settled"
windows after-open
shown_after="$(dashboard_window after-open on)"

docs_before="$(documents "$launch_at" "$open_at")"
docs_after="$(documents "$open_at" "$settled_at")"
socket_after="$(first_page_socket "$open_at")"
same_window="no"
[[ -n "$hidden_before" && "$hidden_before" == "$shown_after" ]] && same_window="yes"
pp_note "dashboard documents: before open=$docs_before, open..+${SETTLE_AFTER_OPEN}s=$docs_after;" \
  "window on screen after open=[${shown_after}] same as preloaded=$same_window;" \
  "page socket ${socket_after} s after open"

{
  echo "## FW-4A first dashboard open, remote mode, variant $VARIANT"
  echo
  echo "source: $(git -C "$SRC" rev-parse --short=12 HEAD)"
  echo
  echo "| moment | dashboard document requests | dashboard window |"
  echo "|---|---|---|"
  echo "| launch to first open | $docs_before | on screen: ${visible_before:-none}, off screen: ${hidden_before:-none} |"
  echo "| first open to +${SETTLE_AFTER_OPEN} s | $docs_after | on screen: ${shown_after:-none} (same window as before open: $same_window) |"
  echo
  echo "- Page WebSocket (upgrade with Origin) after the open: ${socket_after} s."
  echo "- Document = request with Sec-Fetch-Dest: document through the loopback logging proxy (logs/proxy.jsonl)."
  echo "- Window lists: logs/windows-before-open.jsonl, logs/windows-after-open.jsonl."
  echo "- Frames: shots/20-first-open-frame-*.png (frame 00 is ~0 ms after open), shots/30-dashboard-settled.png."
} >"$OUT/summary.md"

if [[ "$VARIANT" == "head" ]]; then
  [[ -z "$visible_before" ]] || pp_fail "patched build: a dashboard window was on screen before the first open"
  [[ "$docs_before" -ge 1 ]] || pp_fail "patched build: no dashboard document request before the first open"
  [[ -n "$hidden_before" ]] || pp_fail "patched build: no off-screen dashboard window before the first open"
  [[ "$same_window" == yes ]] || pp_fail "patched build: first open did not show the preloaded window"
  [[ "$docs_after" -eq 0 ]] || pp_fail "patched build: first open loaded the dashboard document again"
  pp_note "PASS 4a: hidden remote preload loaded the dashboard document off screen; the first open showed that window without a new document load"
else
  [[ "$((docs_before + docs_after))" -ge 1 ]] || pp_fail "base build: no dashboard document at all (harness did not see the dashboard)"
  pp_note "BASE 4a: dashboard documents before open=$docs_before, after open=$docs_after; preloaded window=${hidden_before:-none}"
fi
PP_DONE=1
