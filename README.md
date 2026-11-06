# proof/ios-offline-reconnect-burst

Secretless real-Xcode proof rig for the chat reconnect catalog burst fix (branch fix/ios-reconnect-burst).

- Base: openclaw/openclaw cb73e59f9356796d4eec6ffeffff327e213355a6
- Head commit: 75b5fdd69e4b65c79b22afd8df27adfe2580198b, tree 9abb6dd7fca66db4354c376e7f3063f3538de22e
- rig/head.diff: full fix (git diff --full-index base..head); rig/test-only.diff: the new test file only;
  rig/harness.diff: rig-only proof harness, never part of the fix.
- Workflow `ios-offline-reconnect-burst-proof.yml` (push to this branch or workflow_dispatch):
  - focused: base + test-only.diff, `swift test --filter ChatViewModelReconnectBurstTests` must fail on the
    burst test; then the exact head tree, the related chat view model suites must pass.
  - full-suite: full OpenClawKit `swift test --parallel` on the exact head tree.
- Wire harness (studio iOS simulator, not a workflow job): rig/harness.diff adds a chat Gateway mode to
  NativeGatewayWebSocketFixture (answers chat RPCs, holds chat.history 1.5 s, pushes health events, records
  the wire order) and apps/ios/Tests/IOSReconnectBurstWireProofTests. The test runs the app's real
  IOSGatewayChatTransport and IOSSourceResourceLoader, over GatewayNodeSession and a real URLSession
  WebSocket, in the OpenClaw iOS test host. The fixture drops the socket, sends health false then true, and
  drops it again. rig/ios-sim.sh builds once (xcodebuild build-for-testing, iOS 27.2 simulator, unsigned,
  no Watch target) and runs the test 3 times. Base must re-read a catalog before the first transcript
  answer; the exact head tree must not.
- Known hosted-runner flakes unrelated to this change: TalkBufferedAudioPlayerTests,
  RealtimeTalkRelaySessionReviewTests (audio timing); "stale fallback refresh keeps retrying while run remains
  pending" can take about 64 s under parallel load on base and head alike.
