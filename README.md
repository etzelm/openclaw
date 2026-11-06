# proof/ios-offline-reconnect-burst

Secretless real-Xcode proof rig for the chat reconnect catalog burst fix (branch fix/ios-reconnect-burst).

- Base: openclaw/openclaw cb73e59f9356796d4eec6ffeffff327e213355a6
- Head commit (local): 7348de082bc6a0dcce43f41ec4898e78dadef48c, tree 09b7ea2d9f8ab6462e3ca5daa519097fcfe86aea
- rig/head.diff: full fix (git diff --full-index base..head); rig/test-only.diff: the new test only.
- Workflow `ios-offline-reconnect-burst-proof.yml` (push to this branch or workflow_dispatch):
  - focused: base + test-only.diff, `swift test --filter ChatViewModelReconnectBurstTests` must fail on the new
    test; then the exact head tree, the related chat view model suites must pass. Job fails unless both hold.
    The `RECONNECT_BURST requests=` line in each log is the ordered request list across two quick reconnects.
  - full-suite: full OpenClawKit `swift test --parallel` on the exact head tree.
- Known hosted-runner flakes unrelated to this change: TalkBufferedAudioPlayerTests,
  RealtimeTalkRelaySessionReviewTests (audio timing); "stale fallback refresh keeps retrying while run remains
  pending" can take about 64 s under parallel load on base and head alike.
