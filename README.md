# proof/ios-offline-send-timeout

Secretless real-Xcode proof rig for the chat.send attachment deadline fix (branch fix/ios-send-timeout).

- Base: openclaw/openclaw cb73e59f9356796d4eec6ffeffff327e213355a6
- Head commit (local): 0dcca3676824df3386663e3bacb5dbcbf0a36de8, tree 6f6b08adf9292b4e8a2f8e7b3796fd03de5ae83f
- rig/head.diff: full fix (git diff --full-index base..head); rig/test-only.diff: the new test only.
- Workflow `ios-offline-send-timeout-proof.yml` (workflow_dispatch):
  - focused: base + test-only.diff, `swift test --filter ChatGatewayRequestTests` must fail on the new test;
    then exact head tree, same filter must pass. Job fails unless both hold.
  - full-suite: full OpenClawKit `swift test --parallel` on the exact head tree.
