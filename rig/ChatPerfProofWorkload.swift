// Native proof workload for incremental source previews (PR #193863). The proof rig copies this
// file into OpenClawKitTests on base and head alike; it is never part of a PR. Gated by CHAT_PERF_PROOF=1.
//
// Every message reaches the view model through the chat transport: the initial history and the
// reloads through `requestHistory`, persisted appends as `.sessionMessage` events, and the source
// context through `.chatMetadataChanged` plus `loadSourceContext`. So the measured work always runs
// messages.didSet -> ChatSourcePreviewState.update -> ChatSourcePreviewProjector.project.
#if os(macOS)
import AppKit
import CryptoKit
import Foundation
import OpenClawKit
import os
import SwiftUI
import Testing
@testable import OpenClawChatUI

private final class ProofTransport: @unchecked Sendable, OpenClawChatTransport {
    private let lock = NSLock()
    private var history: [AnyCodable]
    private var requests = 0
    private var sourceContext: OpenClawChatSourceContext?
    private var continuations: [AsyncStream<OpenClawChatTransportEvent>.Continuation] = []

    init(history: [AnyCodable]) {
        self.history = history
    }

    var historyRequests: Int {
        self.lock.withLock { self.requests }
    }

    /// Server side persistence: rows the next history request returns.
    func persist(_ rows: [AnyCodable]) {
        self.lock.withLock { self.history += rows }
    }

    func setSourceContext(_ context: OpenClawChatSourceContext?) {
        self.lock.withLock { self.sourceContext = context }
    }

    func emit(_ event: OpenClawChatTransportEvent) {
        let targets = self.lock.withLock { self.continuations }
        for continuation in targets {
            continuation.yield(event)
        }
    }

    func requestHistory(sessionKey: String) async throws -> OpenClawChatHistoryPayload {
        let rows = self.lock.withLock {
            self.requests += 1
            return self.history
        }
        return OpenClawChatHistoryPayload(
            sessionKey: sessionKey,
            sessionId: "proof-session",
            messages: rows,
            thinkingLevel: "off")
    }

    func sendMessage(
        sessionKey _: String,
        message _: String,
        thinking _: String,
        idempotencyKey _: String,
        attachments _: [OpenClawChatAttachmentPayload]) async throws -> OpenClawChatSendResponse
    {
        OpenClawChatSendResponse(runId: "proof-run", status: "started")
    }

    func requestHealth(timeoutMs _: Int) async throws -> Bool {
        true
    }

    func loadSourceContext() async -> OpenClawChatSourceContext? {
        self.lock.withLock { self.sourceContext }
    }

    func events() -> AsyncStream<OpenClawChatTransportEvent> {
        AsyncStream { continuation in
            self.lock.withLock { self.continuations.append(continuation) }
        }
    }
}

private enum ProofFixture {
    /// Cited replies in the loaded transcript (N).
    static let runs = 80
    /// New turns delivered one persisted message at a time (3 messages per turn).
    static let appendedTurns = 7
    static let reloadsSame = 5
    static let reloadsGrown = 10
    static let contextChanges = 10
    static let epochMs = 1_790_000_000_000.0
    static let gateway = "https://gateway.proof.invalid"

    static let context = OpenClawChatSourceContext(
        gatewayURL: URL(string: gateway + "/")!, basePath: "", publicOrigin: nil)

    static func wrap(_ text: String) -> String {
        """
        <<<EXTERNAL_UNTRUSTED_CONTENT id="0123456789abcdef">>>
        Source: Web Search
        ---
        \(text)
        <<<END_EXTERNAL_UNTRUSTED_CONTENT id="0123456789abcdef">>>
        """
    }

    /// One agent turn: question, web_search result, cited answer. The fourth cited link points at a
    /// gateway chat route, so its card is shown without a source context and suppressed with one.
    static func turn(_ index: Int) -> [OpenClawChatMessage] {
        let runID = "proof-run-\(index)"
        let start = self.epochMs + Double(index) * 60000
        let urls = (0..<3).map { "https://example\($0).com/article-\(index)" } +
            ["\(self.gateway)/chat/main/session-\(index)"]
        let rows: [[String: Any]] = urls.enumerated().map { offset, url in
            [
                "url": url,
                "title": self.wrap("Result \(offset) for question \(index)"),
                "snippet": self.wrap("Snippet \(offset) with **findings** for question \(index) and a [reference](\(url))."),
            ]
        }
        let answer = "Recorded findings with **emphasis** for question \(index).\n\n" +
            "See [one](\(urls[0])), [two](\(urls[1])), [three](\(urls[2])) and [session](\(urls[3]))."
        return [
            OpenClawChatMessage(
                role: "user",
                content: [.init(type: "text", text: "Question \(index): what changed?")],
                timestamp: start),
            OpenClawChatMessage(
                role: "toolResult", content: [], timestamp: start + 1000, transcriptRunID: runID,
                toolCallId: "call-\(index)", toolName: "web_search",
                details: AnyCodable([
                    "kind": "results", "results": rows,
                    "externalContent": ["source": "web_search", "untrusted": true, "wrapped": true],
                ] as [String: Any])),
            OpenClawChatMessage(role: "assistant", content: [
                .init(type: "toolCall", id: "call-\(index)", name: "web_search"),
                .init(type: "tool_result", text: "Recorded", id: "call-\(index)"),
                .init(type: "text", text: answer),
            ], timestamp: start + 2000, transcriptRunID: runID, stopReason: "stop", phase: "final_answer"),
        ]
    }

    static func userRow(_ index: Int) -> OpenClawChatMessage {
        OpenClawChatMessage(
            role: "user",
            content: [.init(type: "text", text: "Follow-up \(index) from another device.")],
            timestamp: self.epochMs + Double(self.runs + self.appendedTurns + index) * 60000)
    }

    static func encode(_ messages: [OpenClawChatMessage]) throws -> [AnyCodable] {
        let data = try JSONEncoder().encode(messages)
        return try JSONDecoder().decode([AnyCodable].self, from: data)
    }
}

/// Deterministic digest of projected cards (Swift's Hasher is seeded per process).
private enum CardDigest {
    static func hex(_ text: String) -> String {
        SHA256.hash(data: Data(text.utf8)).map { String(format: "%02x", $0) }.joined()
    }

    static func describe(_ cards: [ChatSourcePreview]) -> String {
        cards.map { card in
            let kind = card.excerptKind.map { "\($0)" } ?? "-"
            let cited = card.citedURLs.map(\.absoluteString).joined(separator: ",")
            return "\(card.url.absoluteString)|\(card.title)|\(card.domain)|\(card.excerpt ?? "-")|\(kind)|\(cited)"
        }.joined(separator: "\n")
    }

    /// Per cited reply (keyed by run id) plus one digest over all of them in run order.
    @MainActor static func capture(_ vm: OpenClawChatViewModel) -> (perReply: [String: String], all: String, cards: Int) {
        var perReply: [String: String] = [:]
        var cards = 0
        for message in vm.messages {
            guard let runID = message.transcriptRunID,
                  let previews = vm.sourcePreviewState.previews[message.id], !previews.isEmpty else { continue }
            perReply[runID] = self.hex(self.describe(previews))
            cards += previews.count
        }
        let all = perReply.keys.sorted { lhs, rhs in
            (Int(lhs.split(separator: "-").last ?? "") ?? 0) < (Int(rhs.split(separator: "-").last ?? "") ?? 0)
        }.map { "\($0)=\(perReply[$0]!)" }.joined(separator: "\n")
        return (perReply, self.hex(all), cards)
    }
}

@MainActor
private final class ProofRecorder {
    static let watched = [
        "sourceStateUpdate", "project", "cardBuild", "cardTitleRender", "cardExcerptRender",
        "citationParse", "externalFrameStrip", "rowSourcePreviews",
    ]
    let label: String
    let signposter = OSSignposter(subsystem: "ai.openclaw.chatperfproof", category: "workload")
    var phases: [[String: Any]] = []

    init(label: String) {
        self.label = label
    }

    /// Runs `body` once per step and records, per step, the probe count deltas, the duration of
    /// every ChatSourcePreviewState.update call that ran inside it, and the cited replies present.
    func phase(
        _ name: String,
        steps: Int,
        citedReplies: () -> Int,
        _ body: (Int) async throws -> Bool) async rethrows
    {
        let id = self.signposter.makeSignpostID()
        let state = self.signposter.beginInterval("phase", id: id, "\(self.label, privacy: .public) \(name, privacy: .public)")
        var records: [[String: Any]] = []
        var timeouts = 0
        for step in 0..<steps {
            let before = ChatPerfProbe.snapshot()
            let durationsBefore = ChatPerfProbe.durations("sourceStateUpdate").count
            let ok = try await body(step)
            if !ok { timeouts += 1 }
            let after = ChatPerfProbe.snapshot()
            var counts: [String: Int] = [:]
            for key in Self.watched {
                counts[key] = (after[key] ?? 0) - (before[key] ?? 0)
            }
            let updateNs = Array(ChatPerfProbe.durations("sourceStateUpdate").dropFirst(durationsBefore))
            records.append([
                "counts": counts,
                "updateNs": updateNs.map { Int($0) },
                "citedReplies": citedReplies(),
                "ok": ok,
            ])
        }
        self.signposter.endInterval("phase", state)
        self.phases.append(["name": name, "steps": records, "timeouts": timeouts])
    }
}

@Suite(.serialized)
struct ChatPerfProofWorkload {
    static let environment = ProcessInfo.processInfo.environment
    static let enabled = environment["CHAT_PERF_PROOF"] == "1"

    @MainActor private static func pump(_ host: NSView) {
        host.layoutSubtreeIfNeeded()
        for _ in 0..<4 {
            _ = RunLoop.main.run(mode: .default, before: Date())
            host.layoutSubtreeIfNeeded()
        }
    }

    @MainActor private static func settle(_ host: NSView) async {
        self.pump(host)
        await Task.yield()
        self.pump(host)
    }

    @MainActor private static func scrollViews(in view: NSView) -> [NSScrollView] {
        let own = (view as? NSScrollView).map { [$0] } ?? []
        return own + view.subviews.flatMap { Self.scrollViews(in: $0) }
    }

    /// Bounded wait on the main run loop; never waits on an expectation that might not fulfil.
    @MainActor private static func waitUntil(
        _ host: NSView,
        seconds: Double,
        _ condition: () -> Bool) async -> Bool
    {
        let deadline = Date().addingTimeInterval(seconds)
        while !condition() {
            if Date() > deadline { return false }
            self.pump(host)
            try? await Task.sleep(for: .milliseconds(5))
        }
        return true
    }

    /// Lets in-flight bootstrap and refresh work drain: waits until the update count is stable.
    @MainActor private static func quiesce(_ host: NSView, seconds: Double = 0.4) async {
        var last = ChatPerfProbe.snapshot()["sourceStateUpdate"] ?? 0
        var stableSince = Date()
        let deadline = Date().addingTimeInterval(10)
        while Date() < deadline {
            self.pump(host)
            try? await Task.sleep(for: .milliseconds(20))
            let now = ChatPerfProbe.snapshot()["sourceStateUpdate"] ?? 0
            if now != last {
                last = now
                stableSince = Date()
            } else if Date().timeIntervalSince(stableSince) >= seconds {
                return
            }
        }
    }

    @MainActor private static func snapshot(_ view: NSView, to url: URL) {
        guard let rep = view.bitmapImageRepForCachingDisplay(in: view.bounds) else { return }
        view.cacheDisplay(in: view.bounds, to: rep)
        try? rep.representation(using: .png, properties: [:])?.write(to: url)
    }

    @Test(.enabled(if: Self.enabled))
    @MainActor func `source previews follow transport updates in the shared chat view`() async throws {
        let outDir = URL(fileURLWithPath: Self.environment["CHAT_PERF_OUT"] ?? NSTemporaryDirectory())
        let label = Self.environment["CHAT_PERF_LABEL"] ?? "local"
        let sample = Self.environment["CHAT_PERF_SAMPLE"] ?? "0"
        try FileManager.default.createDirectory(at: outDir, withIntermediateDirectories: true)

        _ = NSApplication.shared
        let transport = try ProofTransport(history: ProofFixture.encode((0..<ProofFixture.runs).flatMap(ProofFixture.turn)))
        let vm = OpenClawChatViewModel(sessionKey: "main", transport: transport)
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 960, height: 720),
            styleMask: [.titled, .closable, .resizable],
            backing: .buffered,
            defer: false)
        window.isReleasedWhenClosed = false
        let host = NSHostingView(rootView: OpenClawChatView(
            viewModel: vm,
            displayOptions: [],
            showsAssistantAvatars: false,
            showsComposer: false))
        window.contentView = host
        defer {
            vm.detachTransport()
            window.contentView = nil
            window.close()
        }
        let recorder = ProofRecorder(label: label)
        let cited = { vm.sourcePreviewState.previews.count }
        var digests: [String: String] = [:]
        var expectedRows = ProofFixture.runs * 3

        // Load: ChatView.onAppear starts bootstrap, which requests history from the transport.
        try await recorder.phase("load", steps: 1, citedReplies: cited) { _ in
            await Self.settle(host)
            if transport.historyRequests == 0 { vm.load() }
            let ok = await Self.waitUntil(host, seconds: 30) { vm.messages.count >= expectedRows }
            await Self.quiesce(host)
            return ok
        }
        #expect(vm.messages.count == expectedRows, "history rows loaded: \(vm.messages.count)")
        digests["load"] = CardDigest.capture(vm).all

        // (a) Persisted-message appends: one `.sessionMessage` event per message, as the gateway
        // sends them; the server history grows with each one.
        let appended = (0..<ProofFixture.appendedTurns).flatMap { ProofFixture.turn(ProofFixture.runs + $0) }
        try await recorder.phase("append", steps: appended.count, citedReplies: cited) { step in
            let message = appended[step]
            try transport.persist(ProofFixture.encode([message]))
            expectedRows += 1
            transport.emit(.sessionMessage(OpenClawSessionMessageEventPayload(
                sessionKey: "main", message: message, messageId: nil, messageSeq: nil)))
            let ok = await Self.waitUntil(host, seconds: 10) { vm.messages.count >= expectedRows }
            await Self.settle(host)
            return ok
        }
        #expect(vm.messages.count == expectedRows, "rows after appends: \(vm.messages.count)")
        digests["append"] = CardDigest.capture(vm).all

        // (b1) History reload returning exactly the rows already shown (foreground resume).
        try await recorder.phase("reloadSame", steps: ProofFixture.reloadsSame, citedReplies: cited) { _ in
            let before = transport.historyRequests
            await vm.resumeFromForeground().value
            await Self.settle(host)
            return transport.historyRequests > before
        }
        digests["reloadSame"] = CardDigest.capture(vm).all

        // (b2) History reload with the same message ids plus one new row from another device.
        try await recorder.phase("reloadGrown", steps: ProofFixture.reloadsGrown, citedReplies: cited) { step in
            try transport.persist(ProofFixture.encode([ProofFixture.userRow(step)]))
            expectedRows += 1
            await vm.resumeFromForeground().value
            let ok = await Self.waitUntil(host, seconds: 10) { vm.messages.count >= expectedRows }
            await Self.settle(host)
            return ok
        }
        #expect(vm.messages.count == expectedRows, "rows after reloads: \(vm.messages.count)")
        digests["reloadGrown"] = CardDigest.capture(vm).all

        // (c) Source context changes: `.chatMetadataChanged` makes the view model reload the context
        // from the transport (invalidate to nil, then the loaded value). Alternates gateway / none.
        try await recorder.phase("contextChange", steps: ProofFixture.contextChanges, citedReplies: cited) { step in
            let target: OpenClawChatSourceContext? = step % 2 == 0 ? ProofFixture.context : nil
            transport.setSourceContext(target)
            let start = ChatPerfProbe.snapshot()["sourceStateUpdate"] ?? 0
            transport.emit(.chatMetadataChanged(modelCatalogChanged: false))
            let ok = await Self.waitUntil(host, seconds: 10) {
                (ChatPerfProbe.snapshot()["sourceStateUpdate"] ?? 0) >= start + 2 &&
                    vm.sourcePreviewState.context == target
            }
            await Self.settle(host)
            if step == 0 { digests["contextGateway"] = CardDigest.capture(vm).all }
            return ok
        }
        let final = CardDigest.capture(vm)
        digests["final"] = final.all

        // Screenshot of the first cited replies with their cards.
        if let scrollView = Self.scrollViews(in: host).max(by: {
            ($0.documentView?.frame.height ?? 0) < ($1.documentView?.frame.height ?? 0)
        }) {
            let clip = scrollView.contentView
            let flipped = scrollView.documentView?.isFlipped ?? true
            let maxY = max(0, (scrollView.documentView?.frame.height ?? 0) - clip.bounds.height)
            clip.scroll(to: NSPoint(x: 0, y: flipped ? 0 : maxY))
            scrollView.reflectScrolledClipView(clip)
            for _ in 0..<5 {
                await Self.settle(host)
            }
        }
        Self.snapshot(host, to: outDir.appendingPathComponent("\(label)-\(sample)-cards.png"))

        #expect(final.cards > 0, "source cards projected: \(final.cards)")
        let summary: [String: Any] = [
            "label": label,
            "sample": sample,
            "historyRows": vm.messages.count,
            "citedReplies": final.perReply.count,
            "projectedCards": final.cards,
            "digests": digests,
            "perReplyDigest": final.perReply,
            "phases": recorder.phases,
        ]
        let data = try JSONSerialization.data(withJSONObject: summary, options: [.prettyPrinted, .sortedKeys])
        try data.write(to: outDir.appendingPathComponent("\(label)-\(sample).json"))
        print("CHAT_PERF_PROOF wrote \(label)-\(sample).json rows=\(vm.messages.count) cited=\(final.perReply.count) cards=\(final.cards)")
    }
}
#endif
