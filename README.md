# ios-offline-bg-outbox-flush proof rig

Secretless native proof for the iOS background-wake chat outbox change (branch `fix/ios-bg-outbox-flush`).
Inputs are pinned in `rig/lane.json`; `rig/bg-outbox-flush.diff` is `git diff --full-index <base>..<head>`
and the runner checks that base + diff reproduces the head tree.

Jobs (`.github/workflows/ios-offline-bg-outbox-flush-proof.yml`, macos-26, newest Xcode):
- `swift` focused on `base-tests` (base plus only the new OpenClawKit test file): must fail to build with
  an error naming `drainOutboxForBackgroundWake`, which does not exist on the base.
- `swift` focused on `head`: the new background-wake drain suite plus the existing outbox suites.
- `swift` full on `head`: every OpenClawKit test.
- `ios` base and head: the OpenClaw unit-test bundle on an iPhone simulator runs
  `rig/ios/BgOutboxFlushProofTests.swift` (identical on both sides). It calls the shipped
  `NodeAppModel.handleBackgroundRefreshWake` with the real chat owner, view model, iOS transport and
  offline store, once with one queued row and once with an empty outbox, and records how long the wake
  stays open. There is no Gateway on the runner, so the drain cannot deliver; expected:
  base returns at once with the row still queued (`BASE_GAP_CONFIRMED`), head holds the wake for the
  8 s bounded drain with a queued row and adds no delay with an empty outbox (`HEAD_OK`).
  Head also runs the existing iOS suites around the wake code (NodeAppModelInvokeTests,
  BackgroundAliveBeaconTests, ChatSendHydrationTests, RootTabsPresentationTests).

Artifacts: `ios-base`, `ios-head` (wake-*.txt markers, result.txt, logs), `swift-*` (results).
