import Foundation
import OpenClawKit
import Testing
@testable import OpenClaw
@testable import OpenClawChatUI

/// In-process Gateway for the proof: answers what chat replay and the alive beacon use and
/// records every chat.send. Runs on the fixture's queue.
private final class ProofGateway: @unchecked Sendable {
    private let lock = NSLock()
    private var sends: [(key: String, text: String, at: Date)] = []
    private var calls: [String] = []

    var methodLog: String {
        self.lock.withLock { self.calls.joined(separator: ",") }
    }

    var sentKeys: [String] {
        self.lock.withLock { self.sends.map(\.key) }
    }

    var firstSendAt: Date? {
        self.lock.withLock { self.sends.first?.at }
    }

    func handle(role: String, method: String, params: [String: Any]) -> [String: Any]? {
        self.lock.withLock { self.calls.append("\(role.prefix(1)):\(method)") }
        switch method {
        case "health":
            return ["ok": true]
        case "node.event":
            return ["ok": true, "handled": true, "reason": "beacon_persisted"]
        case "agents.list":
            return ["defaultId": "main", "mainKey": "main", "scope": "per-sender", "agents": [["id": "main"]]]
        case "sessions.list":
            return ["sessions": []]
        case "chat.send":
            let key = params["idempotencyKey"] as? String ?? ""
            self.lock.withLock { self.sends.append((key, params["message"] as? String ?? "", Date())) }
            return ["runId": key, "status": "started"]
        case "chat.history":
            let rows: [[String: Any]] = self.lock.withLock {
                self.sends.map { send in
                    [
                        "id": "history-\(send.key)",
                        "role": "user",
                        "content": [["type": "text", "text": send.text]],
                        "idempotencyKey": "\(send.key):user",
                        "timestamp": send.at.timeIntervalSince1970 * 1000,
                    ]
                }
            }
            return [
                "sessionKey": params["sessionKey"] as? String ?? "agent:main:main",
                "sessionId": "proof-session",
                "messages": rows,
            ]
        default:
            return nil
        }
    }
}

/// Proof-only test, identical on base and head. The issue's path through the shipped app: Chat was
/// connected, the app went to the background and its grace period ended (sessions disconnected),
/// a message is waiting in the durable outbox, and iOS runs a background refresh wake that has to
/// reconnect. It records whether chat.send reached the Gateway before the wake reported done.
@MainActor
@Suite(.serialized)
struct BgOutboxDeliveryProofTests {
    private static let lastSuccessKey = "gateway.backgroundAlive.lastSuccessAtMs"

    @Test func `background refresh wake from disconnected delivers the queued message`() async throws {
        let isolation = await GatewayRegistryTestIsolation()
        defer { isolation.restore() }
        let state = try TemporaryOpenClawState(instanceID: "bg-outbox-delivery-\(UUID().uuidString)")
        defer { state.restore() }
        let defaults = UserDefaults.standard
        let previousSuccess = defaults.object(forKey: Self.lastSuccessKey)
        defer {
            if let previousSuccess {
                defaults.set(previousSuccess, forKey: Self.lastSuccessKey)
            } else {
                defaults.removeObject(forKey: Self.lastSuccessKey)
            }
        }
        defaults.removeObject(forKey: Self.lastSuccessKey)

        let server = try await NativeGatewayWebSocketFixture.start(issuedDeviceTokens: [], tls: true)
        defer { server.stop() }
        let gateway = ProofGateway()
        server.acceptedOperatorScopes = ["operator.read", "operator.write"]
        server.helloCapabilities = ["chat-send-routing-contract", "session-settings-cas-v1"]
        server.requestHandler = { role, method, params in gateway.handle(role: role, method: method, params: params) }

        let stableID = "manual|127.0.0.1|\(server.port)"
        var options = GatewayConnectOptions(
            role: "node",
            scopes: [],
            caps: [],
            commands: [],
            permissions: [:],
            clientId: "openclaw-ios",
            clientMode: "node",
            clientDisplayName: "Outbox proof",
            includeDeviceIdentity: false,
            allowStoredDeviceAuth: false)
        options.deviceAuthGatewayID = stableID
        let tls = GatewayTLSParams(
            required: true,
            expectedFingerprint: server.fingerprint,
            allowTOFU: false,
            storeKey: nil)
        let config = GatewayConnectConfig(
            url: server.url(),
            stableID: stableID,
            tls: tls,
            token: "proof-token",
            bootstrapToken: nil,
            password: nil,
            nodeOptions: options)

        let appModel = NodeAppModel()
        defer { appModel.disconnectGateway() }
        // 1. Foreground: connected, Chat open.
        appModel.applyGatewayConnectConfig(config)
        try await Self.wait("foreground connect", seconds: 20) {
            appModel.gatewayConnected && appModel.isOperatorGatewayConnected
        }
        // Chat queues offline sends only for a known agent; agents.list supplies the default.
        try await Self.wait("default agent", seconds: 20) { appModel.chatDeliveryAgentId != nil }
        appModel.chatPresentation.sync(appModel: appModel)
        let viewModel = try #require(appModel.chatPresentation.viewModel)
        defer { viewModel.detachTransport() }
        try await Self.wait("chat healthy", seconds: 20) { viewModel.healthOK }
        let store = try #require(appModel.makeChatOfflineStore())

        // 2. Background, grace over: the same path that disconnects both sessions in the app.
        appModel.isBackgrounded = true
        appModel.suppressBackgroundReconnect(reason: "proof_grace_expired")
        try await Self.wait("background disconnect", seconds: 20) {
            !appModel.gatewayConnected && !appModel.isOperatorGatewayConnected
        }

        // 3. The user sends while offline: the health check fails, so Chat queues it durably.
        await viewModel.pollHealthIfNeeded(force: true)
        #expect(!viewModel.healthOK)
        viewModel.input = "queued while offline"
        viewModel.send()
        var queued: [OpenClawChatOutboxCommand] = []
        let queueDeadline = Date().addingTimeInterval(20)
        while queued.isEmpty, Date() < queueDeadline {
            try await Task.sleep(nanoseconds: 50_000_000)
            queued = await store.loadCommands()
        }
        print("BG_OUTBOX_DELIVERY_QUEUE error=\(viewModel.errorText ?? "-") input=\(viewModel.input)")
        #expect(queued.map(\.status) == [.queued])
        let commandID = try #require(queued.first?.id)

        // 4. The background refresh wake.
        let started = Date()
        let handled = await appModel.handleBackgroundRefreshWake()
        let returnedAt = Date()
        let sentAtReturn = gateway.sentKeys
        let rowsAtReturn = await store.loadCommands().map(\.status.rawValue)
        // The process stays alive here, which iOS does not promise after the wake reports done.
        let laterDeadline = Date().addingTimeInterval(10)
        while gateway.sentKeys.isEmpty, Date() < laterDeadline {
            try await Task.sleep(nanoseconds: 50_000_000)
        }
        let sentLater = gateway.sentKeys

        let side = ProcessInfo.processInfo.environment["BG_OUTBOX_PROOF_SIDE"] ?? "unknown"
        let sendOffset = gateway.firstSendAt.map { String(format: "%.2f", $0.timeIntervalSince(started)) } ?? "none"
        let line = "BG_OUTBOX_DELIVERY side=\(side) handled=\(handled) "
            + "wakeSeconds=\(String(format: "%.2f", returnedAt.timeIntervalSince(started))) "
            + "sentBeforeReturn=\(sentAtReturn == [commandID]) rowsAtReturn=\(rowsAtReturn.joined(separator: ",")) "
            + "firstSendSeconds=\(sendOffset) sentWithin10sAfter=\(sentLater == [commandID]) "
            + "sendCount=\(sentLater.count) roles=\(server.roles.joined(separator: ","))"
        print(line)
        let rowErrors = await store.loadCommands().map { "\($0.status.rawValue):\($0.lastError ?? "-")" }
        print("BG_OUTBOX_DELIVERY_DEBUG side=\(side) healthOK=\(viewModel.healthOK) "
            + "metadata=\(viewModel.hasCurrentSessionMetadata) error=\(viewModel.errorText ?? "-") "
            + "rows=\(rowErrors.joined(separator: ";")) calls=\(gateway.methodLog)")
        if let out = ProcessInfo.processInfo.environment["BG_OUTBOX_PROOF_OUT"] {
            let url = URL(fileURLWithPath: out).appendingPathComponent("delivery-\(side).txt")
            try? (line + "\n").write(to: url, atomically: true, encoding: .utf8)
        }
        // Common to both sides: at most one send, keyed by the command id.
        #expect(sentLater.count <= 1)
        _ = await appModel.purgeChatTranscriptCache(gatewayID: stableID)
    }

    private static func wait(
        _ what: String,
        seconds: Double,
        _ condition: @MainActor () -> Bool) async throws
    {
        let deadline = Date().addingTimeInterval(seconds)
        while !condition() {
            guard Date() < deadline else {
                Issue.record("timed out waiting for \(what)")
                throw CancellationError()
            }
            try await Task.sleep(nanoseconds: 50_000_000)
        }
    }
}
