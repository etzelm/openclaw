# Device run commands (as run on 2026-11-06)

Placeholders: `<udid>` (iPhone), `<bundle>` (Debug bundle id of the personal-team build, `<base>.debug`),
`<lan-ip>`, `<token>`. Base checkout: main 60a2e23d542. Head checkout: fix/ios-bg-outbox-flush 9216c3d60cb.
Mac: Xcode 27.2 (27B52). iPhone 14 Pro Max, iOS 27.2, Developer Mode on, USB.

## Build and install (same for both sides)

```bash
# in <checkout>: pnpm install && pnpm ios:gen  (signing auto-detected: personal team)
cd apps/ios
# personal-team-spec.diff: drop the app's Share, Widget and Watch dependencies (local copy of project.yml)
xcodegen generate --spec .bgproof.yml
# pinned build-time lint tools: ./scripts/install-swift-tools.sh <dir>; PATH=<dir>:$PATH
xcodebuild -project OpenClaw.xcodeproj -scheme OpenClaw -configuration Debug \
  -destination id=<udid> -derivedDataPath <dd> -allowProvisioningUpdates \
  OPENCLAW_CODE_SIGN_ENTITLEMENTS=<path>/bgproof.entitlements build
xcrun devicectl device install app --device <udid> <dd>/Build/Products/Debug-iphoneos/OpenClaw.app
```

## Isolated test Gateway (from the base checkout)

```bash
pnpm build
node openclaw.mjs --profile bgproof gateway run --allow-unconfigured --port 19789 --bind lan \
  --auth token --token <token> --ws-log compact > gw.log 2>&1 &
# pair: launch with the setup link, tap Connect once on the phone, then approve (list and approve in one step,
# because the app re-requests and supersedes the request id)
xcrun devicectl device process launch --device <udid> \
  --payload-url "openclaw-debug://gateway?host=<lan-ip>&port=19789&token=<token>" <bundle>
node openclaw.mjs --profile bgproof devices list --url ws://127.0.0.1:19789 --token <token> --json
node openclaw.mjs --profile bgproof devices approve <requestId> --url ws://127.0.0.1:19789 --token <token>
```

## Log capture and debugger (one session per build)

```bash
# app os_log lines mirrored to the console file
xcrun devicectl device process launch --device <udid> --terminate-existing --start-stopped --console \
  --environment-variables '{"OS_ACTIVITY_DT_MODE":"YES"}' <bundle> > console.log 2>&1 &
# one long-lived lldb session fed from a command file; attaching only works to the launched-stopped process
: > lldb.cmds; tail -n +1 -f lldb.cmds | xcrun lldb --no-use-colors > lldb.log 2>&1 &
printf '%s\n' "device select <udid>" "device process attach -p <pid>" >> lldb.cmds
echo "process continue" >> lldb.cmds
```

## Runs (per build)

```bash
GW=$(lsof -nP -iTCP:19789 -sTCP:LISTEN -t)
S='(id)[NSClassFromString(@"BGTaskScheduler") sharedScheduler]'
ID='<bundle>.bgrefresh'
kill -STOP $GW            # Gateway unreachable; then the message is typed and sent on the phone (Chat queues it)

# Run B (expiry): background, launch the task 8 s into the grace, expire it 4 s after "wake received"
xcrun devicectl device process launch --device <udid> <bundle>; sleep 4   # foreground first
xcrun devicectl device process launch --device <udid> com.apple.Preferences
sleep 8
printf '%s\n' "process interrupt" \
  "expr -l objc -- (void)[$S performSelector:@selector(_simulateLaunchForTaskWithIdentifier:) withObject:@\"$ID\"]" \
  "process continue" >> lldb.cmds
# wait for "Background refresh wake received" in console.log, then 4 s
printf '%s\n' "process interrupt" \
  "expr -l objc -- (void)[$S performSelector:@selector(_simulateExpirationForTaskWithIdentifier:) withObject:@\"$ID\"]" \
  "process continue" >> lldb.cmds

# Run A (delivery): foreground, background, launch 8 s into the grace, resume the Gateway 1 s later
xcrun devicectl device process launch --device <udid> <bundle>; sleep 4
xcrun devicectl device process launch --device <udid> com.apple.Preferences
sleep 8
printf '%s\n' "process interrupt" \
  "expr -l objc -- (void)[$S performSelector:@selector(_simulateLaunchForTaskWithIdentifier:) withObject:@\"$ID\"]" \
  "process continue" >> lldb.cmds
sleep 1; kill -CONT $GW
```

The launch has to be issued while the app is still running in the background: after the 25 s grace iOS suspends
the debug app and the debugger expression cannot run.

## Gateway-side check

```bash
sqlite3 -readonly ~/.openclaw-bgproof/agents/main/agent/openclaw-agent.sqlite \
  "select role, timestamp, text from session_transcript_fts where text like '%bg proof%'"
```

## Cleanup

```bash
printf '%s\n' "process detach" "quit" >> lldb.cmds
xcrun devicectl device uninstall app --device <udid> <bundle>
kill -TERM $GW; rm -rf ~/.openclaw-bgproof
```
