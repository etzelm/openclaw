# ChatUI native proof: static preview regexes (p3)

Secretless GitHub Actions workflow (`.github/workflows/chatui-perf-proof.yml`) that runs on a
GitHub-hosted macOS runner with the newest installed Xcode (floor: Xcode 26.4, Swift tools 6.3).
This branch holds only the rig; nothing here is part of any PR.

Reproduce: push this branch to a fork (or run it locally on a Mac with Xcode, phase by phase:
`bash rig/run-lane.sh prepare|focused|build|workload 5|summary|trace`).

1. `prepare`: fetches upstream base `9f3ed313782`, applies `rig/lanes/p3.diff` and refuses to
   continue unless the tree equals the PR head tree recorded in `rig/lanes.json`; installs native
   assets per side.
2. `focused`: builds base and head with Xcode and runs `ChatSourcePreviewTests` and
   `ChatLinkPreview*` on unmodified code.
3. `build`: applies identical scratch call counters to both sides (`rig/instrument.py`,
   `rig/ChatPerfProbe.swift`), adds `rig/ChatPerfProofWorkload.swift` to the test target, builds
   release with testing enabled. Fails if probe placement differs apart from line numbers.
4. `workload`: base and head interleaved, 5 rounds, one fresh process per sample. The real shared
   `OpenClawChatView` in an `NSHostingView` in an `NSWindow`, fed a 60-turn cited web_search
   transcript through an `OpenClawChatTransport` (`requestHistory`), then scrolled, resized,
   appended to and streamed; then direct `chatFirstPreviewURL` passes over every bubble text and 50
   Open Graph parses over two fixture pages (with og:title, and with the `<title>` fallback).
   NSRegularExpression compiles are counted per pattern family by swapping
   `-initWithPattern:options:error:` in the test process only. Output equality: SHA-256 per row of
   the bubble link preview URL, all preview URLs and the source cards, the Open Graph results, and
   the transcript screenshot bytes.
5. `summary`: `summary.md` and `counts.json`; `trace`: optional os_signpost recording, exported
   filtered to the rig's own subsystem.

Counts are the claim; wall times on shared hosted runners are reported with spread and are not a
device frame-rate or latency claim.
