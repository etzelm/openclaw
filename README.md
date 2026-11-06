# ios-offline-bg-outbox-flush proof rig

Secretless native proof for the iOS background-wake chat outbox change (branch `fix/ios-bg-outbox-flush`).
Inputs are pinned in `rig/lane.json`; `rig/bg-outbox-flush.diff` is `git diff --full-index <base>..<head>`
and the runner checks that base + diff reproduces the head tree.

OpenClawKit (`rig/swift.sh`):
- `base-tests` (base plus only the new test file): must fail to build on the missing drain API.
- `head` focused (the background-wake drain suite plus the existing outbox suites) and full.

iOS simulator (`rig/ios/run.sh` on Actions, `rig/ios/studio-run-sim.sh` on the studio, which has no Rust
toolchain and so drops the app's Watch dependency from a local copy of project.yml). Both sides add the same
two proof tests and `rig/harness.diff` (test fixture only: the existing NativeGatewayWebSocketFixture answers a
few Gateway methods after connect and advertises hello capabilities):
- `BgOutboxDeliveryProofTests`: the shipped app connects to the local TLS WebSocket Gateway, goes to the
  background, its grace period ends through `suppressBackgroundReconnect`, the user sends while offline, then
  `handleBackgroundRefreshWake` reconnects. Records whether chat.send reached the Gateway before the wake
  returned. Expected: base `BASE_NOT_DELIVERED_BEFORE_RETURN`, head `HEAD_DELIVERED` (exactly one send).
- `BgOutboxFlushProofTests`: wake timing with no Gateway, queued row vs empty outbox. Expected: base returns at
  once (`BASE_GAP_CONFIRMED`); head holds a queued row's wake for the 8 s bound and adds no delay when empty
  (`HEAD_OK`).
- Head also runs NodeAppModelInvokeTests, BackgroundAliveBeaconTests, ChatSendHydrationTests,
  RootTabsPresentationTests.

Artifacts: delivery-*.txt, wake-*.txt markers, result.txt, logs.
