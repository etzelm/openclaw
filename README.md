# ChatUI performance native proof rig

Secretless GitHub Actions workflow (`.github/workflows/chatui-perf-proof.yml`) that runs on
GitHub-hosted macOS runners with the newest installed Xcode (floor: Xcode 26.4, Swift tools 6.3).
This branch holds only the rig; nothing here is part of any PR.

For each lane in `rig/lanes.json`:

1. Fetches the exact upstream base SHA from `openclaw/openclaw`, applies `rig/lanes/<lane>.diff`
   and refuses to continue unless the resulting tree equals the PR head tree recorded in `lanes.json`.
2. Builds OpenClawKit base and head with Xcode and runs the focused suites
   (`ChatSourcePreviewTests`, `ChatLinkPreview*`) on unmodified code.
3. Applies identical scratch instrumentation to both sides (`rig/instrument.py`: one call counter
   per changed function; `rig/ChatPerfProbe.swift`), adds `rig/ChatPerfProofWorkload.swift` to the
   test target and builds release with testing enabled.
4. Runs the workload ABAB, 5 samples per side: the real shared `OpenClawChatView` hosted in an
   `NSHostingView` in an `NSWindow`, fed a 60-turn cited web_search transcript through a local test
   transport, then scrolled (64 positions), resized (4 widths), appended to (10 new turns), streamed
   (24 deltas), plus 50 OpenGraph metadata parses with a fixture page. Per phase it records call
   counts, NSRegularExpression compiles by pattern family (Objective-C method counter, no product
   change) and wall time, with an `os_signpost` interval per phase.
5. Records one extra run per side with `xctrace` (Time Profiler + os_signpost) and exports only the
   rig's own signpost intervals (`rig/signposts.py`).
6. Uploads `chatui-perf-proof-<lane>`: `summary.md`, raw samples, instrumentation diffs, probe
   placements, signpost export, transcript screenshots, build and test logs.

A second job runs the full OpenClawKit `swift test` on each unmodified head tree.

Counts are the claim; wall times on shared hosted runners are reported with spread and are not a
device frame-rate or latency claim.
