#!/usr/bin/env bash
# Shared helpers for the Mac focus week proof scenarios.
# Runs only on a disposable GitHub-hosted macOS runner. Every Gateway, state
# directory and fixture server is created by the job and listens on loopback.
#
# Required env (set by .github/workflows/mac-focus-week-proof.yml):
#   SRC      checkout of the PR head (or its base) with dependencies installed
#   OUT      artifact directory for this matrix entry
#   HARNESS  checkout of the proof harness (this directory's repo)
#   APP      packaged OpenClaw.app (unset for CLI-only scenarios)

set -euo pipefail

: "${SRC:?SRC is required}"
: "${OUT:?OUT is required}"
: "${HARNESS:?HARNESS is required}"

PP_ROOT="${RUNNER_TEMP:-$(mktemp -d)}/mac-proof"
PP_BIN="$PP_ROOT/bin"
PP_LIB="$HARNESS/scripts/mac-proof/lib"
PP_BUNDLE_ID="${PP_BUNDLE_ID:-ai.openclaw.mac.debug}"
PP_TOKEN="${PP_TOKEN:-$(openssl rand -hex 24)}"
PP_GATEWAY_PORT="${PP_GATEWAY_PORT:-28789}"
PP_FIXTURE_PORT="${PP_FIXTURE_PORT:-28790}"
PP_START_EPOCH="$(date +%s)"
PP_START_LOG="$(date '+%Y-%m-%d %H:%M:%S')"
mkdir -p "$PP_ROOT" "$PP_BIN" "$OUT/shots" "$OUT/logs"
export PP_TOKEN

pp_note() {
  # Timestamped scenario log; the step summary is built from this file.
  printf '%s %s\n' "$(date '+%H:%M:%S')" "$*" | tee -a "$OUT/scenario.log"
}

pp_fail() {
  pp_note "FAIL: $*"
  pp_shot "fail" || true
  pp_ax dump "$OUT/logs/ax-fail.json" || true
  exit 1
}

pp_wait_for() {
  # pp_wait_for <seconds> <description> <command...>
  local limit="$1" what="$2"
  shift 2
  local i
  for ((i = 0; i < limit; i++)); do
    if "$@" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  pp_fail "timed out after ${limit}s waiting for: $what"
}

pp_wait_quiet() {
  # pp_wait_quiet <seconds> <command...>: like pp_wait_for, but returns 1 on timeout.
  local limit="$1" i
  shift
  for ((i = 0; i < limit; i++)); do
    if "$@" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  return 1
}

pp_build_helpers() {
  # Compile the AppKit/CoreGraphics helpers once per job.
  swiftc -O -o "$PP_BIN/window-id" "$PP_LIB/window-id.swift"
  swiftc -O -o "$PP_BIN/click" "$PP_LIB/click.swift"
  swiftc -O -o "$PP_BIN/tcc-check" "$PP_LIB/tcc-check.swift"
  swiftc -O -o "$PP_BIN/ocr" "$PP_LIB/ocr.swift"
  swiftc -O -o "$PP_BIN/record" "$PP_LIB/record.swift"
}

pp_cli() {
  # CLI from the checked-out source, pointed at the job-owned Gateway state.
  OPENCLAW_STATE_DIR="$PP_ROOT/gateway-state" \
    OPENCLAW_CONFIG_PATH="$PP_ROOT/gateway-state/openclaw.json" \
    OPENCLAW_GATEWAY_TOKEN="$PP_TOKEN" \
    OPENCLAW_NO_BANNER=1 \
    node "$SRC/openclaw.mjs" "$@"
}

pp_call() {
  # pp_call <method> <json-params>
  pp_cli gateway call "$1" --url "ws://127.0.0.1:$PP_GATEWAY_PORT" --token "$PP_TOKEN" \
    --json --params "$2"
}

pp_tool() {
  # pp_tool <json-body>: POST /tools/invoke on the job-owned Gateway.
  curl -sS --max-time "${PP_TOOL_TIMEOUT:-120}" \
    -H "Authorization: Bearer $PP_TOKEN" -H 'Content-Type: application/json' \
    --data "$1" "http://127.0.0.1:$PP_GATEWAY_PORT/tools/invoke"
}

pp_gateway_start() {
  # pp_gateway_start <config-json>: fresh state dir, loopback bind, token auth.
  # gateway.port/bind/auth are forced so CLI helpers reach this Gateway only.
  local config="$1"
  rm -rf "$PP_ROOT/gateway-state"
  mkdir -p "$PP_ROOT/gateway-state"
  node -e '
    const [raw, port] = process.argv.slice(1);
    const cfg = JSON.parse(raw);
    cfg.gateway = { ...(cfg.gateway ?? {}), mode: "local", port: Number(port), bind: "loopback",
      auth: { mode: "token" } };
    process.stdout.write(JSON.stringify(cfg, null, 2) + "\n");' \
    "$config" "$PP_GATEWAY_PORT" >"$PP_ROOT/gateway-state/openclaw.json"
  cp "$PP_ROOT/gateway-state/openclaw.json" "$OUT/logs/gateway-config.json"
  pp_cli gateway run --port "$PP_GATEWAY_PORT" --bind loopback --auth token \
    --token "$PP_TOKEN" --allow-unconfigured --verbose >>"$OUT/logs/gateway.log" 2>&1 &
  echo $! >"$PP_ROOT/gateway.pid"
  pp_wait_for 120 "Gateway health on 127.0.0.1:$PP_GATEWAY_PORT" \
    pp_cli gateway health --url "ws://127.0.0.1:$PP_GATEWAY_PORT" --token "$PP_TOKEN"
  pp_note "gateway up on loopback:$PP_GATEWAY_PORT (pid $(cat "$PP_ROOT/gateway.pid"))"
}

pp_gateway_stop() {
  if [[ -f "$PP_ROOT/gateway.pid" ]]; then
    local pid
    pid="$(cat "$PP_ROOT/gateway.pid")"
    pkill -TERM -P "$pid" 2>/dev/null || true
    kill "$pid" 2>/dev/null || true
    rm -f "$PP_ROOT/gateway.pid"
  fi
  # The CLI wrapper can exit while the Gateway keeps the port; free it by listener
  # so the next case cannot be answered by a stale Gateway.
  local pids i
  for ((i = 0; i < 15; i++)); do
    pids="$(lsof -ti "tcp:$PP_GATEWAY_PORT" -sTCP:LISTEN 2>/dev/null || true)"
    [[ -z "$pids" ]] && return 0
    kill $pids 2>/dev/null || true
    sleep 1
  done
  pp_note "warning: port $PP_GATEWAY_PORT still has a listener after pp_gateway_stop"
}

pp_fixture_start() {
  # pp_fixture_start [port]: loopback HTTP fixture that records every hit.
  local port="${1:-$PP_FIXTURE_PORT}"
  node "$PP_LIB/fixture-server.mjs" "$port" "$OUT/logs/fixture-hits.jsonl" \
    >>"$OUT/logs/fixture-$port.log" 2>&1 &
  echo $! >"$PP_ROOT/fixture-$port.pid"
  pp_wait_for 20 "fixture on $port" curl -sf "http://127.0.0.1:$port/health"
}

pp_fixture_stop() {
  local port="${1:-$PP_FIXTURE_PORT}"
  if [[ -f "$PP_ROOT/fixture-$port.pid" ]]; then
    kill "$(cat "$PP_ROOT/fixture-$port.pid")" 2>/dev/null || true
    rm -f "$PP_ROOT/fixture-$port.pid"
  fi
}

pp_fixture_hits() {
  # pp_fixture_hits <path-prefix>: number of recorded requests for that path.
  [[ -f "$OUT/logs/fixture-hits.jsonl" ]] || {
    echo 0
    return
  }
  grep -c "\"path\":\"$1" "$OUT/logs/fixture-hits.jsonl" || true
}

pp_approve_pairing() {
  # pp_approve_pairing <seconds>: approves every pending device and node pairing
  # request on the job-owned Gateway until one was approved and none remain.
  local limit="$1" i kind ids approved=0 seen
  for ((i = 0; i < limit; i += 2)); do
    seen=0
    for kind in device node; do
      ids="$(pp_call "$kind.pair.list" '{}' 2>/dev/null | node -e '
        let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => {
          try {
            const j = JSON.parse(s);
            for (const p of j.pending ?? []) console.log(p.requestId);
          } catch {}
        });')"
      [[ -n "$ids" ]] || continue
      seen=1
      while IFS= read -r id; do
        pp_call "$kind.pair.approve" "{\"requestId\":\"$id\"}" >>"$OUT/logs/pairing.log" 2>&1 &&
          approved=$((approved + 1)) && pp_note "approved $kind pairing request $id"
      done <<<"$ids"
    done
    if [[ "$seen" -eq 0 && "$approved" -gt 0 ]]; then
      return 0
    fi
    sleep 2
  done
  # Loopback pairing can be approved silently by the Gateway; the caller's
  # "node connected" wait is the real gate.
  [[ "$approved" -gt 0 ]] || pp_note "no pairing request needed approval within ${limit}s"
}

pp_node_id() {
  # pp_node_id <a|b|...>: id of a connected node whose name/platform/id contains one needle.
  pp_call node.list '{}' | node -e '
    const needles = process.argv[1].toLowerCase().split("|");
    let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => {
      const j = JSON.parse(s);
      const nodes = j.nodes ?? j.result?.nodes ?? [];
      const hit = nodes.find((n) => n.connected !== false &&
        needles.some((x) => JSON.stringify([n.displayName, n.platform, n.nodeId]).toLowerCase().includes(x)));
      if (!hit) process.exit(1);
      console.log(hit.nodeId ?? hit.id);
    });' "$1"
}

pp_app_config() {
  # Remote-mode app config aimed at the job-owned loopback Gateway, so the
  # app never runs onboarding and never touches a real Gateway.
  local extra="${1:-}"
  mkdir -p "$PP_ROOT/app-state"
  cat >"$PP_ROOT/app-state/openclaw.json" <<JSON
{
  "gateway": {
    "mode": "remote",
    "remote": {
      "transport": "direct",
      "url": "ws://127.0.0.1:$PP_GATEWAY_PORT",
      "token": "$PP_TOKEN"
    }
  }${extra}
}
JSON
  local domain version
  if [[ "${PP_LOCAL:-}" == 1 ]]; then
    # Local reruns: start each run with the fresh WebKit and defaults state a
    # hosted runner has. Only the PR build's own bundle id and named profile.
    [[ "$PP_BUNDLE_ID" == ai.openclaw.mac.debug && -n "${PP_APP_PROFILE:-}" ]] ||
      pp_fail "PP_LOCAL needs PP_BUNDLE_ID=ai.openclaw.mac.debug and PP_APP_PROFILE"
    defaults delete "$PP_BUNDLE_ID" >/dev/null 2>&1 || true
    defaults delete "ai.openclaw.mac.profile.$PP_APP_PROFILE" >/dev/null 2>&1 || true
    rm -rf "$HOME/Library/WebKit/$PP_BUNDLE_ID" "$HOME/Library/HTTPStorages/$PP_BUNDLE_ID" \
      "$HOME/Library/HTTPStorages/$PP_BUNDLE_ID.binarycookies" "$HOME/Library/Caches/$PP_BUNDLE_ID"
  fi
  version="$(sed -nE 's/^let currentOnboardingVersion = ([0-9]+).*/\1/p' \
    "$SRC/apps/macos/Sources/OpenClaw/Constants.swift")"
  for domain in "$PP_BUNDLE_ID" ${PP_APP_PROFILE:+"ai.openclaw.mac.profile.$PP_APP_PROFILE"}; do
    defaults write "$domain" openclaw.onboardingSeen -bool true
    defaults write "$domain" openclaw.onboardingVersion -int "$version"
  done
}

pp_app_launch() {
  # pp_app_launch [app args...]
  : "${APP:?APP is required for app scenarios}"
  # PP_APP_PROFILE (local reruns): a named profile owns its own instance lock,
  # defaults suite and Keychain service, so the app runs beside a daily OpenClaw.
  open -n -F "$APP" \
    ${PP_APP_PROFILE:+--env "OPENCLAW_PROFILE=$PP_APP_PROFILE"} \
    --env "OPENCLAW_STATE_DIR=$PP_ROOT/app-state" \
    --env "OPENCLAW_CONFIG_PATH=$PP_ROOT/app-state/openclaw.json" \
    --env "OPENCLAW_LOG_DIR=$OUT/logs/app" \
    --args "$@"
  pp_wait_for 60 "OpenClaw process" pgrep -f "$APP/Contents/MacOS/"
  pp_note "app launched: $(basename "$APP") args: $*"
}

pp_app_activate() {
  # Keystrokes go to the frontmost app.
  osascript -e "tell application id \"$PP_BUNDLE_ID\" to activate" >/dev/null 2>&1 || true
  sleep 1
}

pp_app_quit() {
  osascript -e "tell application id \"$PP_BUNDLE_ID\" to quit" >/dev/null 2>&1 || true
  sleep 3
  pkill -f "$APP/Contents/MacOS/" 2>/dev/null || true
}

pp_app_pid() {
  pgrep -f "$APP/Contents/MacOS/" | head -1
}

pp_ax() {
  # pp_ax <verb> [args...]: accessibility helper, see ax.js.
  osascript -l JavaScript "$PP_LIB/ax.js" "$PP_BUNDLE_ID" "$@"
}

pp_require_front() {
  # Keys and HID clicks go to the frontmost app. With a daily OpenClaw running
  # beside the PR build (local reruns), refuse to send them anywhere else.
  [[ -z "${APP:-}" ]] && return 0
  pgrep -f "$APP/Contents/MacOS/" >/dev/null || return 0
  if ! command osascript -l JavaScript "$PP_LIB/ax.js" "$PP_BUNDLE_ID" frontmost >/dev/null 2>&1; then
    command osascript -e "tell application id \"$PP_BUNDLE_ID\" to activate" >/dev/null 2>&1 || true
    sleep 1
    if ! command osascript -l JavaScript "$PP_LIB/ax.js" "$PP_BUNDLE_ID" frontmost >/dev/null 2>&1; then
      local r
      r="$(command osascript -l JavaScript "$PP_LIB/ax.js" "$PP_BUNDLE_ID" raise 10 2>&1)" ||
        pp_fail "PR build is not the frontmost app; refusing to send keys or clicks (raise: $r)"
      pp_note "raised PR build: $r"
    fi
  fi
}

osascript() {
  # Every keystroke in the scenarios goes through System Events; guard them all.
  case "$*" in
    *"System Events"*keystroke* | *"System Events"*"key code"*) pp_require_front ;;
  esac
  command osascript "$@"
}

pp_click_element() {
  # pp_click_element <role> <text> [native|web]: HID-level click at the element's
  # center in screen coordinates (WebKit reports web elements relative to their
  # AXWebArea; screen-frame adds that origin).
  local frame x y
  frame="$(pp_ax screen-frame "$1" "$2" "${3:-}")" || return 1
  x="$(printf '%s' "$frame" | sed -nE 's/.*"cx":([0-9.]+).*/\1/p')"
  y="$(printf '%s' "$frame" | sed -nE 's/.*"cy":([0-9.]+).*/\1/p')"
  [[ -n "$x" && -n "$y" ]] || return 1
  pp_require_front
  "$PP_BIN/click" "$x" "$y"
}

pp_type() {
  # pp_type <text>: types into the focused control, then Return.
  osascript -e "tell application \"System Events\" to keystroke \"$1\"" \
    -e 'tell application "System Events" to key code 36'
}

pp_shot() {
  # pp_shot <name>: the app's frontmost real window plus the full screen.
  local name="$1" wid
  local frame=""
  # The PR build's tab failure view lives in a window-sized overlay window, so a
  # single-window (-l) shot of it has no toolbar or address. Capture the main
  # window's on-screen rect instead (the PR build is kept frontmost).
  # Only when the PR build is frontmost: a rect shot of anything else could
  # capture another app (pp_fail calls pp_shot, so do not fail from here).
  if [[ -z "${PP_WINDOW_OWNER:-}" ]] && pp_ax frontmost >/dev/null 2>&1 &&
    frame="$(pp_ax window-frame 2>/dev/null)"; then
    wid="rect $frame"
    screencapture -x -R "$frame" "$OUT/shots/$name.png"
  else
    wid="$("$PP_BIN/window-id" "${PP_WINDOW_OWNER:-$(pp_app_pid 2>/dev/null || echo OpenClaw)}" 2>/dev/null || true)"
    [[ -n "$wid" ]] && screencapture -x -o -l "$wid" "$OUT/shots/$name.png"
  fi
  # Local reruns (PP_LOCAL=1) run on a personal desktop: window shots only.
  [[ "${PP_LOCAL:-}" == 1 ]] || screencapture -x "$OUT/shots/$name-screen.png"
  pp_note "shot $name (window ${wid:-none})"
}

pp_screen_text() {
  # pp_screen_text <needle>: "<x> <y> <text>" in screen points for the first
  # match in the PR build's window, read with Vision (see ocr.swift). Native
  # views inside a WKWebView are not in the accessibility tree.
  local frame wx wy ww img px py
  frame="$(pp_ax window-frame)" || return 1
  IFS=, read -r wx wy ww _ <<<"$frame"
  img="$PP_ROOT/ocr-window.png"
  pp_require_front
  screencapture -x -R "$frame" "$img" || return 1
  read -r px py text < <("$PP_BIN/ocr" "$img" "$1") || return 1
  local iw
  iw="$(sips -g pixelWidth "$img" | awk '/pixelWidth/{print $2}')"
  # Window shots are in pixels; the window frame is in points.
  awk -v px="$px" -v py="$py" -v wx="$wx" -v wy="$wy" -v ww="$ww" -v iw="$iw" -v t="$text" \
    'BEGIN { s = iw / ww; printf "%d %d %s\n", wx + px / s, wy + py / s, t }'
}

pp_wait_screen_text() {
  # pp_wait_screen_text <seconds> <needle>
  local limit="$1" needle="$2" i
  for ((i = 0; i < limit; i++)); do
    pp_screen_text "$needle" && return 0
    sleep 1
  done
  return 1
}

pp_wait_screen_text_gone() {
  # pp_wait_screen_text_gone <seconds> <needle>
  local limit="$1" needle="$2" i
  for ((i = 0; i < limit; i++)); do
    pp_screen_text "$needle" >/dev/null || return 0
    sleep 1
  done
  return 1
}

pp_click_screen_text() {
  # pp_click_screen_text <needle> [below-needle]: HID click on recognized text,
  # optionally only a match below another recognized line.
  local hit x y anchor ay
  hit="$(pp_screen_text "$1")" || return 1
  read -r x y _ <<<"$hit"
  if [[ -n "${2:-}" ]]; then
    anchor="$(pp_screen_text "$2")" || return 1
    read -r _ ay _ <<<"$anchor"
    (( y > ay )) || return 1
  fi
  pp_require_front
  "$PP_BIN/click" "$x" "$y"
  echo "$x $y"
}

pp_record_start() {
  # Records only the PR build's windows (record.swift, ScreenCaptureKit) until
  # pp_record_stop or PP_RECORD_MAX seconds. Call after the app has a window.
  local pid=""
  [[ -n "${APP:-}" ]] && pid="$(pp_app_pid)"
  if [[ -n "$pid" ]]; then
    "$PP_BIN/record" "$pid" "$OUT/recording.mov" "${PP_RECORD_MAX:-600}" >"$OUT/logs/recording.log" 2>&1 &
  else
    # No app window yet (scenarios that record from before launch, or CLI-only
    # ones): full-screen screencapture, acceptable only on a disposable runner.
    [[ "${PP_LOCAL:-}" == 1 ]] && pp_fail "local reruns record only the PR build; start the app first"
    screencapture -x -v -V "${PP_RECORD_MAX:-600}" "$OUT/recording.mov" >"$OUT/logs/recording.log" 2>&1 &
  fi
  echo $! >"$PP_ROOT/record.pid"
  sleep 2
  kill -0 "$(cat "$PP_ROOT/record.pid")" 2>/dev/null || pp_fail "recorder did not start (see logs/recording.log)"
}

pp_record_stop() {
  if [[ -f "$PP_ROOT/record.pid" ]]; then
    local pid i
    pid="$(cat "$PP_ROOT/record.pid")"
    kill -INT "$pid" 2>/dev/null || true
    # record.swift finalizes the movie on SIGINT; never leave it running.
    for ((i = 0; i < 40; i++)); do kill -0 "$pid" 2>/dev/null || break; sleep 0.5; done
    if kill -0 "$pid" 2>/dev/null; then
      kill -KILL "$pid" 2>/dev/null || true
      pp_note "recorder did not stop on SIGINT; killed (recording may be incomplete)"
    fi
    rm -f "$PP_ROOT/record.pid"
  fi
}

pp_collect() {
  # Unified log of the app since scenario start, then token redaction.
  log show --style compact --info --debug --start "$PP_START_LOG" \
    --predicate 'subsystem BEGINSWITH "ai.openclaw"' >"$OUT/logs/app-unified.log" 2>&1 || true
  pp_redact
}

pp_redact() {
  # The token is per-job random, but never ship it in artifacts.
  local f
  while IFS= read -r -d '' f; do
    LC_ALL=C sed -i '' -e "s/$PP_TOKEN/<redacted-token>/g" "$f" 2>/dev/null || true
  done < <(find "$OUT" -type f \( -name '*.log' -o -name '*.json' -o -name '*.jsonl' -o -name '*.txt' -o -name '*.md' \) -print0)
}

pp_cleanup() {
  pp_record_stop
  [[ -n "${APP:-}" ]] && pp_app_quit
  pp_gateway_stop
  local p
  for p in "$PP_ROOT"/fixture-*.pid; do
    [[ -f "$p" ]] && kill "$(cat "$p")" 2>/dev/null || true
  done
  pp_collect
}

pp_identity() {
  # Records which build produced the evidence (ClawSweeper asks for it).
  {
    echo "item=${ITEM:-} variant=${VARIANT:-} pr=${PR:-}"
    echo "source_sha=$(git -C "$SRC" rev-parse HEAD)"
    echo "expected_sha=${EXPECTED_SHA:-}"
    echo "runner=$(sw_vers -productVersion) $(uname -m) xcode=$(xcodebuild -version 2>/dev/null | head -1)"
    [[ -n "${APP:-}" ]] && /usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' \
      "$APP/Contents/Info.plist" 2>/dev/null | sed 's/^/app_version=/'
    [[ -n "${APP:-}" ]] && codesign -dv "$APP" 2>&1 | grep -E '^(Identifier|Signature)=' || true
  } | tee "$OUT/identity.txt"
}
