# Native proof rig for openclaw/openclaw#193863 (incremental source previews)

Secretless GitHub Actions workflow (`.github/workflows/chatui-perf-proof.yml`) on GitHub-hosted
macOS runners with the newest installed Xcode (floor: Xcode 26.4, Swift tools 6.3). This branch
holds only the rig; nothing here is part of the PR. Rerun: push a commit to this branch.

Job `workload`:

1. Fetches base `6b959f4ca63` from `openclaw/openclaw`, applies `rig/lanes/p2.diff`
   (`git diff --full-index 6b959f4ca63..8b22c9d931f`) and stops unless the tree equals the PR head
   tree `fd196e4a47b` recorded in `rig/lanes.json`.
2. Applies identical scratch instrumentation to base and head (`rig/instrument.py`, `rig/ChatPerfProbe.swift`):
   a call counter at the top of each source preview function, plus an `os_signpost` interval and a
   monotonic timer around `ChatSourcePreviewState.update`. Copies `rig/ChatPerfProofWorkload.swift`
   into the test target and builds release with testing enabled.
3. Runs the workload 7 rounds, base and head interleaved, one process per sample: the real
   `OpenClawChatView` / `OpenClawChatViewModel` in an `NSHostingView` in an `NSWindow`, fed by a
   local `OpenClawChatTransport`. History (80 cited replies) arrives through `requestHistory`;
   21 persisted messages arrive as `.sessionMessage` events; reloads go through
   `resumeFromForeground()` and `requestHistory`; context changes go through `.chatMetadataChanged`
   and `loadSourceContext`. Per step it records counts, the duration of every update call, and a
   SHA-256 of the projected cards per cited reply.
4. Records one extra run per side under `xctrace` (os_signpost instrument, fixed time limit) and
   exports only the rig's own intervals (`rig/signposts.py`).
5. Uploads `chatui-perf-proof-p2`: `summary.md`, `counts.json`, raw samples, screenshots,
   instrumentation diffs, probe placements, logs.

Job `full-suite` runs the full OpenClawKit `swift test` on the unmodified head tree.

Counts are the claim; wall times on a shared hosted runner are reported with median and p95 and
are not a device latency claim. This is a macOS runner, not a phone.
