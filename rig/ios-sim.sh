#!/bin/bash
# Studio driver for the wire harness on the iOS simulator (run inside a prepared source tree:
# base + harness.diff, or the exact head tree + harness.diff). SIDE=base|head.
# Drops the Watch target from a local copy of project.yml because the studio has no Rust toolchain.
O=$PWD/rb-out; rm -rf $O rb-out.tgz; mkdir -p $O
TOOLS=$HOME/crabbox/rb-tools; mkdir -p $TOOLS; export PATH="$TOOLS:$PATH"
DD=$HOME/crabbox/rb-dd-$SIDE
stamp() { echo "=== $(date -u +%H:%M:%S) $*"; }
lane() {
  { echo "side $SIDE"; xcodebuild -version; swift --version 2>&1 | head -1; sw_vers; shasum apps/shared/OpenClawKit/Sources/OpenClawChatUI/ChatViewModel+TransportEvents.swift apps/ios/Tests/IOSReconnectBurstWireProofTests.swift apps/shared/OpenClawKit/Tests/OpenClawKitTests/NativeGatewayWebSocketFixture.swift apps/ios/Sources/Chat/IOSGatewayChatTransport.swift; } > $O/environment.txt
  stamp tools
  [ -x $TOOLS/xcodegen ] || ./scripts/install-xcodegen.sh $TOOLS > $O/tools.log 2>&1 || { echo TOOLS_FAIL; tail -10 $O/tools.log; return; }
  [ -x $TOOLS/swiftformat ] || ./scripts/install-swift-tools.sh $TOOLS >> $O/tools.log 2>&1 || { echo SWIFTTOOLS_FAIL; tail -10 $O/tools.log; return; }
  stamp deps
  pnpm install --frozen-lockfile > $O/pnpm.log 2>&1 || { echo PNPM_FAIL; tail -10 $O/pnpm.log; return; }
  node scripts/prepare-apple-mermaid.mjs > $O/mermaid.log 2>&1 || { echo MERMAID_FAIL; return; }
  stamp gen
  pnpm ios:gen > $O/iosgen.log 2>&1 || { echo IOSGEN_FAIL; tail -20 $O/iosgen.log; return; }
  (cd apps/ios && awk '!done && $0 == "      - target: OpenClawWatchApp" { done = 1; next } { print }' project.yml > .nowatch.yml && diff project.yml .nowatch.yml > $O/nowatch-spec.diff; xcodegen generate --spec .nowatch.yml >> $O/iosgen.log 2>&1) || { echo NOWATCH_FAIL; return; }
  stamp simulator
  SIM=$(xcrun simctl create "rb-proof-$SIDE" "iPhone 18 Pro" com.apple.CoreSimulator.SimRuntime.iOS-27-2) || { echo SIM_FAIL; return; }
  echo "$SIM iPhone 18 Pro iOS 27.2" > $O/simulator.txt
  xcrun simctl boot $SIM > $O/boot.log 2>&1; perl -e 'alarm shift; exec @ARGV' 300 xcrun simctl bootstatus $SIM -b >> $O/boot.log 2>&1 || { echo BOOT_FAIL; tail -5 $O/boot.log; }
  X=(-project apps/ios/OpenClaw.xcodeproj -scheme OpenClaw -configuration Debug -destination "platform=iOS Simulator,id=$SIM" -derivedDataPath $DD -parallel-testing-enabled NO -collect-test-diagnostics never ARCHS=$(uname -m) ONLY_ACTIVE_ARCH=YES COMPILER_INDEX_STORE_ENABLE=NO CODE_SIGNING_ALLOWED=NO -only-testing:OpenClawTests/IOSReconnectBurstWireProofTests)
  stamp build-for-testing
  perl -e 'alarm shift; exec @ARGV' 4000 xcodebuild "${X[@]}" build-for-testing > $O/build.log 2>&1; echo "build exit $?"; grep -E "error:" $O/build.log | head -10
  for i in 1 2 3; do
    stamp "test run $i"
    TEST_RUNNER_RECONNECT_WIRE_OUT=$O/wire-$i.txt perl -e 'alarm shift; exec @ARGV' 600 xcodebuild "${X[@]}" test-without-building > $O/test-$i.log 2>&1; echo "test $i exit $?" | tee -a $O/test-$i.log
    grep -E "RECONNECT_WIRE_SUMMARY" $O/wire-$i.txt 2>/dev/null || echo "no wire file"; grep -E "Test run with|\*\* TEST" $O/test-$i.log | tail -2
  done
  xcrun simctl shutdown $SIM >/dev/null 2>&1; xcrun simctl delete $SIM >/dev/null 2>&1; echo "simulator deleted"
}
lane; tar czf rb-out.tgz rb-out; true
