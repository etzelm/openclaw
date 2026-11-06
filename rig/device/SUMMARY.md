# Physical device proof, base vs head (2026-11-06)

iPhone 14 Pro Max, iOS 27.2, Developer Mode on, USB. Built on the MacBook with Xcode 27.2 (27B52) per side: base main
60a2e23d542, head fix/ios-bg-outbox-flush 9216c3d60cb. Same local signing setup on both sides (below). An isolated test
Gateway built from the base checkout (`openclaw --profile bgproof gateway run`, its own state dir, LAN bind, token auth),
paired through `openclaw-debug://gateway?...` plus `devices approve`. Logs: the app's own os_log lines mirrored by
`xcrun devicectl device process launch --console` with OS_ACTIVITY_DT_MODE=YES (head-console.txt, base-console.txt).

| | Run B: expiry (Gateway paused) | Run A: delivery (Gateway resumed 1 s after the launch) |
|---|---|---|
| head | wake received, reconnect begin; expired 4 s later; `Wake chat outbox skipped reason=cancelled`; outcome `connect_timeout chat=skipped durationMs=4036`; finished; message still queued | wake received, reconnect begin, both sessions reconnect; `Wake chat outbox result=delivered`; outcome `chat=delivered durationMs=1662`; then finished. Gateway user turn at 13:40:42.163 |
| base | wake received, reconnect begin; expired 4.4 s later; outcome `connect_timeout durationMs=4395` (no chat step); finished; message still queued | wake received, reconnect begin, both sessions reconnect; outcome `beacon_failed durationMs=1458` (no chat step); task finished at 14:03:11.654 while the message was still queued. Gateway user turn at 14:03:13.074, after the task had finished; it got out only because the leftover grace kept the process running |

How the runs were driven, all remote except typing the message:
- The message was typed on the phone (one per build) while the test Gateway was paused with SIGSTOP, so Chat queued it
  ("chat.ui send queued ... OpenClawChatTransportSendError").
- Background: `xcrun devicectl device process launch com.apple.Preferences` (a real app switch). The app logged the
  real 25 s grace and scheduled a real BGAppRefresh request.
- BGTask: one lldb session attached to the app (launched with `--start-stopped`), running Apple's documented
  `_simulateLaunchForTaskWithIdentifier:` / `_simulateExpirationForTaskWithIdentifier:` on
  `<bundle id>.bgrefresh`.

Limits:
- Grace-window trigger: iOS suspends the debug app once the grace ends, and the lldb expression then cannot run (the
  first head attempt after the grace hung). So the BGTask is launched about 8 s into a real grace window. The wake
  still had to reconnect, because the Gateway had been unreachable, but the process was not resumed from suspension
  by the OS. For the same reason, base's message could go out in the grace time left after its task finished, which a
  real BGTask wake would not have.
- Beacon: this test Gateway rejected `node.event` for the pairing ("node pairing changed while invocation was
  active"), so both sides report `beacon_failed` / `handled=false` and the task finishes with `applied=false`. Same on
  both sides; unrelated to this change.
- Personal-team build: the team cannot sign Push Notifications, and has no profiles for the embedded Watch, Share and
  Widget targets. Both sides were built from a local copy of project.yml without those three app dependencies and
  with an empty entitlements file (no aps-environment, App Groups or HealthKit). Not committed. Chat databases live
  in the app's own Application Support, so the outbox is unaffected; a real silent push was not possible.
- Clocks: device lines use the phone clock and Gateway times the laptop clock. The Gateway logged the beacon
  rejection at 14:03:11.643 and the phone logged the reply at 14:03:11.650, so the two clocks agree to within a few
  tens of milliseconds.
- Expiry: in both run B traces the expiry arrived while the wake was still reconnecting (Gateway paused), so the
  outbox wait was skipped (`reason=cancelled` on head) rather than cut short mid-wait.
- Grace end reason: base logs `Background grace ended reason=expired` and head `reason=timer`, both about 25-26 s
  after the grace started. That is OS timing jitter between the background task's expiry and the app's 25 s timer,
  not a base/head difference.

Cleanup: debug app uninstalled, test Gateway stopped, ~/.openclaw-bgproof removed. ~/oc-proof left for deletion.
