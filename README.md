# proof/ios-offline-keepalive-miss

Secretless real-Xcode proof rig for reconnecting after consecutive missed keepalive pongs (branch fix/ios-keepalive-miss).

- Base: openclaw/openclaw cb73e59f9356796d4eec6ffeffff327e213355a6
- Head commit (local): 1c4b421973dee58cf13ba38a85d57ea9c29c0c27, tree 14a1ed9c5b04c221a9878edfd35a304ead1935f0
- rig/head.diff: full fix (git diff --full-index base..head).
- rig/red.diff (tree 9f6b7a9016187eae9e4e4969c0427032ef212301): head with the keepalive catch block restored to the base
  behavior (failures ignored). It keeps the DEBUG test seam and the new tests, which cannot compile on bare base.
- Workflow `ios-offline-keepalive-miss-proof.yml`:
  - focused: red tree, `swift test --filter GatewayNetworkPathRecoveryTests` must fail on
    "consecutive keepalive misses reconnect before the tick watchdog" and pass
    "a keepalive miss between healthy pongs keeps the socket"; then the exact head tree, same filter must pass.
  - full-suite: full OpenClawKit `swift test --parallel` on the exact head tree.
