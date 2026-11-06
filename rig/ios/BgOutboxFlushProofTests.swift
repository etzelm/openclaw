import Foundation
import OpenClawChatUI
import OpenClawKit
import Testing
@testable import OpenClaw

/// Proof-only test, identical on base and head. It drives the shipped app's background refresh
/// wake (NodeAppModel.handleBackgroundRefreshWake) with the real chat owner, view model, iOS
/// transport and offline store. The simulator has no Gateway: a recent beacon makes the wake skip
/// its reconnect, so the only remaining work is whatever the wake does for the chat outbox.
/// It records how long the wake stays open and what happens to a queued row; rig/ios/run.sh
/// compares the numbers per side.
@MainActor
@Suite(.serialized)
struct BgOutboxFlushProofTests {
    private static let lastSuccessKey = "gateway.backgroundAlive.lastSuccessAtMs"

    @Test func `background refresh wake with a queued chat message`() async throws {
        let result = try await Self.measureWake(queued: true)
        // Common to both sides: the wake still completes and the queued row is never lost.
        #expect(result.statuses == ["queued"])
        Self.record("queued", result)
    }

    @Test func `background refresh wake with an empty outbox`() async throws {
        let result = try await Self.measureWake(queued: false)
        #expect(result.statuses.isEmpty)
        Self.record("empty", result)
    }

    private struct WakeResult {
        let seconds: Double
        let handled: Bool
        let statuses: [String]
    }

    private static func measureWake(queued: Bool) async throws -> WakeResult {
        let defaults = UserDefaults.standard
        let previous = defaults.object(forKey: self.lastSuccessKey)
        defer {
            if let previous {
                defaults.set(previous, forKey: self.lastSuccessKey)
            } else {
                defaults.removeObject(forKey: self.lastSuccessKey)
            }
        }
        defaults.set(Date().timeIntervalSince1970 * 1000, forKey: self.lastSuccessKey)

        let appModel = NodeAppModel()
        let gatewayID = "bg-outbox-proof-\(UUID().uuidString)"
        appModel.connectedGatewayID = gatewayID
        let store = try #require(appModel.makeChatOfflineStore())
        appModel.chatPresentation.sync(appModel: appModel)
        let viewModel = try #require(appModel.chatPresentation.viewModel)
        if queued {
            #expect(await store.enqueueCommand(OpenClawChatOutboxCommand(
                id: UUID().uuidString,
                sessionKey: "main",
                deliverySessionKey: "agent:main:main",
                routingContract: "per-sender|main|main",
                agentID: "main",
                text: "queued while offline",
                thinking: "off",
                createdAt: Date().timeIntervalSince1970,
                status: .queued,
                retryCount: 0,
                lastError: nil)))
        }
        appModel.isBackgrounded = true
        appModel.gatewayConnected = true
        appModel.setOperatorConnected(true)

        let started = Date()
        let handled = await appModel.handleBackgroundRefreshWake()
        let seconds = Date().timeIntervalSince(started)
        let statuses = await store.loadCommands().map(\.status.rawValue)

        viewModel.detachTransport()
        _ = await appModel.purgeChatTranscriptCache(gatewayID: gatewayID)
        return WakeResult(seconds: seconds, handled: handled, statuses: statuses)
    }

    private static func record(_ name: String, _ result: WakeResult) {
        let env = ProcessInfo.processInfo.environment
        let side = env["BG_OUTBOX_PROOF_SIDE"] ?? "unknown"
        let wakeSeconds = String(format: "%.2f", result.seconds)
        let rows = result.statuses.joined(separator: ",")
        let line = "BG_OUTBOX_PROOF side=\(side) case=\(name) wakeSeconds=\(wakeSeconds) "
            + "handled=\(result.handled) rows=\(rows)"
        print(line)
        guard let out = env["BG_OUTBOX_PROOF_OUT"] else { return }
        let url = URL(fileURLWithPath: out).appendingPathComponent("wake-\(name)-\(side).txt")
        try? (line + "\n").write(to: url, atomically: true, encoding: .utf8)
    }
}
