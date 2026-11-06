# proof/ios-offline-keepalive-miss

Secretless real-Xcode proof rig for reconnecting after consecutive missed keepalive pongs (branch fix/ios-keepalive-miss).

- Base: openclaw/openclaw cb73e59f9356796d4eec6ffeffff327e213355a6
- Head commit (local): 67ab8ea59a6e443ec29eb52343ca285f4cab8bba, tree 8beb1700ee42c07a14e17ceff164dff312da5b91
- rig/head.diff: full fix (git diff --full-index base..head).
- rig/red.diff (tree 7cba07ddcfbd9c1616a0a675b07e41ef66089760): head with the keepalive catch block restored to the base
  behavior (failures ignored). It keeps the DEBUG test seam and the new tests, which cannot compile on bare base.
- Workflow `ios-offline-keepalive-miss-proof.yml`:
  - focused: red tree, `swift test --filter GatewayNetworkPathRecoveryTests` must fail on
    "consecutive keepalive misses reconnect before the tick watchdog" and pass
    "a keepalive miss between healthy pongs keeps the socket"; then the exact head tree, same filter must pass.
  - full-suite: full OpenClawKit `swift test --parallel` on the exact head tree.
