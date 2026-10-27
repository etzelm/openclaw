#!/usr/bin/env bash
# FW-6 (#185433): authority-chain proof for dashboard HTML widget links.
# Review ask: a real widget click in the shipped macOS dashboard opening the
# link in the default browser, plus synthetic clicks, forged widget/subframe
# requests and retired-document requests rejected before the external open.
# Every candidate URL points at the loopback fixture, so the fixture's hit log
# (with the opener's User-Agent) is the final-effect record: only /widget may
# appear, and it must come from the default browser, not the app.
source "$(dirname "$0")/lib/common.sh"
trap pp_cleanup EXIT

SESSION="agent:main:main"
FIX="http://127.0.0.1:$PP_FIXTURE_PORT"

widget_html() {
  # $1 = version tag. v1 carries the allowed link and every forbidden attempt.
  cat <<HTML
<div style="font:18px -apple-system;padding:16px">
<p><a id="allowed" target="_blank" href="$FIX/widget">Open widget link</a></p>
<p><a id="synthetic" target="_blank" href="$FIX/synthetic">synthetic target</a></p>
<iframe id="sub" style="width:300px;height:60px;border:1px solid #ccc" srcdoc="
  <a id='s' target='_blank' href='$FIX/subframe-click'>subframe</a>
  <script>
    setTimeout(function () {
      document.getElementById('s').click();
      try { window.open('$FIX/subframe-open', '_blank'); } catch (e) {}
      try { top.postMessage({ type: 'request', method: 'host.open', params: { url: '$FIX/subframe-forged' } }, '*'); } catch (e) {}
    }, 2500);
  </script>"></iframe>
<p id="tag">widget $1</p>
<script>
  setTimeout(function () {
    document.getElementById('synthetic').click();
    document.getElementById('synthetic').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    try { window.open('$FIX/forged-open', '_blank'); } catch (e) {}
    try { parent.postMessage({ type: 'request', method: 'host.open', params: { url: '$FIX/forged-request' } }, '*'); } catch (e) {}
  }, 2000);
  if ('$1' === 'v1') {
    setTimeout(function () {
      try { window.open('$FIX/retired-open', '_blank'); } catch (e) {}
      try { parent.postMessage({ type: 'request', method: 'host.open', params: { url: '$FIX/retired-request' } }, '*'); } catch (e) {}
    }, 30000);
  }
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
}

pp_identity
pp_build_helpers
pp_record_start
pp_gateway_start '{"gateway":{"mode":"local"}}'
pp_fixture_start
pp_app_config
pp_app_launch --dashboard
pp_ax wait-window 90 >/dev/null || pp_fail "dashboard window never appeared"
sleep 10

# 1. Show the session dashboard with the v1 widget.
pp_call ui.command "{\"command\":{\"kind\":\"navigate\",\"sessionKey\":\"$SESSION\"}}" \
  >"$OUT/logs/ui-navigate.json" || pp_fail "ui.command navigate failed"
put_widget v1
pp_tool "{\"tool\":\"dashboard\",\"args\":{\"action\":\"set_presentation\",\"presentation\":\"split\"},\"sessionKey\":\"$SESSION\"}" \
  >"$OUT/logs/dashboard-presentation.json" || true
sleep 8
pp_ax dump "$OUT/logs/ax-widget.json" >/dev/null || true
pp_shot "10-widget-visible"

# 2. Forbidden attempts fire on their own timers; none may reach the fixture.
sleep 6
pp_shot "11-after-synthetic-attempts"

# 3. One real HID click on the allowed link.
pp_click_element AXLink "Open widget link" web || pp_fail "widget link not found in AX tree"
pp_wait_for 30 "default browser hit on /widget" test "$(pp_fixture_hits /widget)" -ge 1
sleep 5
PP_WINDOW_OWNER=Safari pp_shot "20-default-browser"
pp_shot "21-app-after-click"

# 4. Retire the v1 document; its delayed requests must not open anything.
put_widget v2
sleep 35
pp_shot "30-after-retire"

grep '"path":"/widget"' "$OUT/logs/fixture-hits.jsonl" >"$OUT/logs/allowed-hit.jsonl" || true
forbidden=0
for path in /synthetic /forged-open /forged-request /subframe-click /subframe-open \
  /subframe-forged /retired-open /retired-request; do
  n="$(pp_fixture_hits "$path")"
  pp_note "final-effect hits $path = $n"
  forbidden=$((forbidden + n))
done
pp_note "allowed hit opener: $(head -1 "$OUT/logs/allowed-hit.jsonl")"
grep -q 'Safari' "$OUT/logs/allowed-hit.jsonl" || pp_fail "/widget was not opened by the default browser"
[[ "$forbidden" -eq 0 ]] || pp_fail "$forbidden forbidden request(s) reached an external open"
pp_note "PASS 6: real click opened the default browser; synthetic, forged, subframe and retired requests produced no open"
