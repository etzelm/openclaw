# Native proof rig, lane p1 (split-row citation cache, openclaw/openclaw#193741)

Secretless GitHub Actions workflow (`.github/workflows/chatui-perf-proof.yml`) on GitHub-hosted
macOS runners with the newest installed Xcode (floor: Xcode 26.4, Swift tools 6.3). This branch
holds only the rig; nothing here is part of the PR.

1. Fetches base `6d7347b2da3` from openclaw/openclaw, applies `rig/lanes/p1.diff`
   (`git diff 6d7347b2da3..9ac44a540b9`) and refuses to continue unless the tree equals the head tree.
2. Builds OpenClawKit base and head with Xcode, runs `ChatSourcePreviewTests|ChatLinkPreview` on
   unmodified code.
3. Adds identical scratch counters to both sides (`rig/instrument.py`, `rig/ChatPerfProbe.swift`),
   including a wrapper around the `sourcePreviews:` argument in `ChatView.messageRow`, so counts can be
   attributed to that path (`<label>@messageRow`) and each row's rendered cards are recorded.
4. Runs the workload (`rig/ChatPerfProofWorkload.swift`) interleaved base/head, 5 rounds: the real
   `OpenClawChatView` in an `NSHostingView`/`NSWindow`, configured like the macOS Quick Chat reply area
   (desktop layout, which folds completed work and splits answers into presentation rows), history
   delivered through the chat transport's `requestHistory`, 60 agent turns with and without web_search
   results (cards / no cards). Phases: load, scroll (64 positions), resize (4 widths), append (10 turns),
   stream (24 deltas). Per phase: probe counts, wall time, os_signpost intervals.
5. Output check: SHA-256 over every rendered row's cards (URL, title, domain, excerpt) keyed by run id,
   role and presentation block index; must be equal on base and head. Screenshots per side.
6. Optional Time Profiler trace, attached to the workload process only, reduced to aggregate sample
   counts of the changed functions (`rig/timeprofile.py`).
