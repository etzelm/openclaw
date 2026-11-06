// Native proof workload for the shared chat view. The proof rig copies this file into
// OpenClawKitTests on base and head alike; it is never part of a PR. Gated by CHAT_PERF_PROOF=1.
#if os(macOS)
import AppKit
import CryptoKit
import Foundation
import ObjectiveC
import OpenClawKit
import os
import SwiftUI
import Testing
@testable import OpenClawChatUI

private final class ProofTransport: @unchecked Sendable, OpenClawChatTransport {
    private let lock = NSLock()
    private let history: [AnyCodable]
    private var requests = 0

    init(history: [AnyCodable]) {
        self.history = history
    }

    var historyRequests: Int {
        self.lock.withLock { self.requests }
    }

    func requestHistory(sessionKey: String) async throws -> OpenClawChatHistoryPayload {
        self.lock.withLock { self.requests += 1 }
        return OpenClawChatHistoryPayload(
            sessionKey: sessionKey,
            sessionId: "proof-session",
            messages: self.history,
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

    func events() -> AsyncStream<OpenClawChatTransportEvent> {
        AsyncStream { $0.finish() }
    }
}

/// Counts NSRegularExpression compiles by pattern family without touching product code.
private enum RegexCompileCounter {
    static func family(_ pattern: String) -> String {
        if pattern.contains("https?://") { return "bareURL" }
        if pattern.contains("EXTERNAL_UNTRUSTED_CONTENT") { return "externalFrame" }
        if pattern.contains("<title") { return "htmlTitle" }
        if pattern.contains("&#(x") { return "htmlEntity" }
        if pattern.contains("[A-Za-z_:]") { return "htmlAttribute" }
        return "other"
    }

    static let installed: Bool = {
        let selector = NSSelectorFromString("initWithPattern:options:error:")
        guard let method = class_getInstanceMethod(NSRegularExpression.self, selector) else { return false }
        typealias Original = @convention(c) (
            UnsafeRawPointer?, Selector, UnsafeRawPointer?, UInt, UnsafeRawPointer?) -> UnsafeRawPointer?
        let original = unsafeBitCast(method_getImplementation(method), to: Original.self)
        let replacement: @convention(block) (
            UnsafeRawPointer?, UnsafeRawPointer?, UInt, UnsafeRawPointer?) -> UnsafeRawPointer? =
            { receiver, pattern, options, error in
                if let pattern {
                    let text = Unmanaged<NSString>.fromOpaque(pattern).takeUnretainedValue() as String
                    ChatPerfProbe.hit("regexCompile." + RegexCompileCounter.family(text))
                }
                return original(receiver, selector, pattern, options, error)
            }
        method_setImplementation(method, imp_implementationWithBlock(replacement))
        return true
    }()
}

private enum ProofFixture {
    static let runs = 60
    static let appended = 10
    static let epochMs = 1_790_000_000_000.0

    static func wrap(_ text: String, name: String) -> String {
        """
        <<<EXTERNAL_UNTRUSTED_CONTENT id="0123456789abcdef">>>
        Source: \(name == "web_search" ? "Web Search" : "Web Fetch")
        ---
        \(text)
        <<<END_EXTERNAL_UNTRUSTED_CONTENT id="0123456789abcdef">>>
        """
    }

    /// One agent turn: question, web_search result, cited answer that splits into three presentation parts.
    static func turn(_ index: Int) -> [OpenClawChatMessage] {
        let runID = "proof-run-\(index)"
        let start = self.epochMs + Double(index) * 60000
        let urls = (0..<3).map { "https://example\($0).com/article-\(index)" }
        let rows: [[String: Any]] = urls.enumerated().map { offset, url in
            [
                "url": url,
                "title": self.wrap("Result \(offset) for question \(index)", name: "web_search"),
                "snippet": self.wrap(
                    "Snippet \(offset) with **findings** for question \(index) and a [reference](\(url)).",
                    name: "web_search"),
            ]
        }
        let paragraph = String(
            repeating: "This paragraph summarizes recorded findings with **emphasis** and plain prose. ",
            count: 12)
        let answer = "\(paragraph)\n\nSee [one](\(urls[0])), [two](\(urls[1])) and [three](\(urls[2])). " +
            "Raw link https://example9.com/raw-\(index) for later.\n\n\(paragraph)"
        return [
            OpenClawChatMessage(
                role: "user",
                content: [.init(type: "text", text: "Question \(index): what changed in https://example.org/q-\(index)?")],
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
                .init(type: "toolCall", id: "next-\(index)", name: "read"),
                .init(type: "tool_result", text: "Recorded next", id: "next-\(index)"),
            ], timestamp: start + 2000, transcriptRunID: runID, phase: "final_answer"),
        ]
    }

    static func history() throws -> [AnyCodable] {
        let messages = (0..<self.runs).flatMap(self.turn)
        let data = try JSONEncoder().encode(messages)
        return try JSONDecoder().decode([AnyCodable].self, from: data)
    }

    static let openGraphHTML = """
    <html><head><title>Fixture &amp; page</title>
    <meta property="og:title" content="Proof &#x27;page&#x27; title">
    <meta name="description" content="A &quot;fixture&quot; description &amp; more">
    <meta property="og:image" content="/images/card.png">
    </head><body><p>Body</p></body></html>
    """

    /// No og:title, so the parser falls back to <title> and the title pattern runs too.
    static let openGraphTitleFallbackHTML = """
    <html><head><title>Fallback &#8211; title &lt;here&gt;</title>
    <meta name="description" content="Plain description">
    <meta property="og:image:url" content="https://cdn.example.com/a.png">
    </head><body></body></html>
    """

    static func digest(_ value: String) -> String {
        SHA256.hash(data: Data(value.utf8)).map { String(format: "%02x", $0) }.joined()
    }
}

@MainActor
private final class ProofRecorder {
    let label: String
    let signposter = OSSignposter(subsystem: "ai.openclaw.chatperfproof", category: "workload")
    var phases: [[String: Any]] = []
    var timings: [String: [Double]] = [:]
    let clock = ContinuousClock()

    init(label: String) {
        self.label = label
    }

    func phase(_ name: String, steps: Int, _ body: () async throws -> Void) async rethrows {
        let before = ChatPerfProbe.snapshot()
        let id = self.signposter.makeSignpostID()
        let state = self.signposter.beginInterval("phase", id: id, "\(self.label, privacy: .public) \(name, privacy: .public)")
        let started = self.clock.now
        try await body()
        let elapsed = started.duration(to: self.clock.now)
        self.signposter.endInterval("phase", state)
        let after = ChatPerfProbe.snapshot()
        var counts: [String: Int] = [:]
        for (key, value) in after where value - (before[key] ?? 0) > 0 {
            counts[key] = value - (before[key] ?? 0)
        }
        let ms = Double(elapsed.components.seconds) * 1000 + Double(elapsed.components.attoseconds) / 1e15
        self.phases.append(["name": name, "steps": steps, "ms": ms, "counts": counts])
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

    @discardableResult
    @MainActor private static func snapshot(_ view: NSView, to url: URL) -> String {
        guard let rep = view.bitmapImageRepForCachingDisplay(in: view.bounds) else { return "none" }
        view.cacheDisplay(in: view.bounds, to: rep)
        guard let png = rep.representation(using: .png, properties: [:]) else { return "none" }
        try? png.write(to: url)
        return SHA256.hash(data: png).map { String(format: "%02x", $0) }.joined()
    }

    /// What each bubble shows that depends on the changed code: the link preview URL the bubble
    /// derives (ChatMessageBubble.linkPreviewURL), every preview URL in its text, and its source cards.
    @MainActor private static func rowFingerprints(_ vm: OpenClawChatViewModel) -> [String] {
        vm.messages.enumerated().map { (index, message) -> String in
            let role = message.role.lowercased()
            let text = ChatMessageVisibleText.displayText(in: message, includeThinking: false)
            let urls = chatPreviewURLs(in: text)
            let cards = vm.sourcePreviews(for: message)
            var preview = ""
            if role == "user" || role == "assistant", let first = urls.first,
               role != "assistant" || !cards.contains(where: { $0.represents(first) })
            {
                preview = first.absoluteString
            }
            let cardText: [String] = cards.map { card -> String in
                let fields: [String] = [
                    card.url.absoluteString, card.title, card.domain, card.excerpt ?? "-",
                    String(describing: card.excerptKind),
                    card.citedURLs.map(\.absoluteString).joined(separator: ","),
                ]
                return fields.joined(separator: "|")
            }
            let fields: [String] = [
                "\(index)", role, preview, urls.map(\.absoluteString).joined(separator: ","),
                cardText.joined(separator: ";"),
            ]
            let row = fields.joined(separator: "\n")
            return ProofFixture.digest(row)
        }
    }

    @Test(.enabled(if: Self.enabled))
    @MainActor func `shared chat view renders a cited transcript`() async throws {
        let outDir = URL(fileURLWithPath: Self.environment["CHAT_PERF_OUT"] ?? NSTemporaryDirectory())
        let label = Self.environment["CHAT_PERF_LABEL"] ?? "local"
        let sample = Self.environment["CHAT_PERF_SAMPLE"] ?? "0"
        try FileManager.default.createDirectory(at: outDir, withIntermediateDirectories: true)
        let regexCounting = RegexCompileCounter.installed

        _ = NSApplication.shared
        let transport = try ProofTransport(history: ProofFixture.history())
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
        let expectedRows = ProofFixture.runs * 3
        var loaded = false

        try await recorder.phase("load", steps: 1) {
            await Self.settle(host)
            if transport.historyRequests == 0 { vm.load() }
            loaded = await Self.waitUntil(host, seconds: 30) { vm.messages.count >= expectedRows }
            await Self.settle(host)
        }
        #expect(loaded, "history rows loaded: \(vm.messages.count)")

        let scrollView = Self.scrollViews(in: host).max {
            ($0.documentView?.frame.height ?? 0) < ($1.documentView?.frame.height ?? 0)
        }
        #expect(scrollView != nil)
        let positions = 16
        let cycles = 2
        try await recorder.phase("scroll", steps: positions * 2 * cycles) {
            guard let scrollView else { return }
            for _ in 0..<cycles {
                for forward in [true, false] {
                    for step in 0..<positions {
                        let clip = scrollView.contentView
                        let maxY = max(0, (scrollView.documentView?.frame.height ?? 0) - clip.bounds.height)
                        let fraction = Double(forward ? step : positions - 1 - step) / Double(positions - 1)
                        clip.scroll(to: NSPoint(x: 0, y: maxY * fraction))
                        scrollView.reflectScrolledClipView(clip)
                        await Self.settle(host)
                    }
                }
            }
        }
        let screenshotDigest = Self.snapshot(
            host, to: outDir.appendingPathComponent("\(label)-\(sample)-transcript.png"))

        let widths: [CGFloat] = [720, 1120, 840, 960]
        try await recorder.phase("resize", steps: widths.count) {
            for width in widths {
                window.setContentSize(NSSize(width: width, height: 720))
                await Self.settle(host)
            }
        }

        try await recorder.phase("append", steps: ProofFixture.appended) {
            for offset in 0..<ProofFixture.appended {
                vm.replaceMessages(vm.messages + ProofFixture.turn(ProofFixture.runs + offset))
                await Self.settle(host)
            }
        }

        let words = (0..<24).map { "word\($0)" }
        try await recorder.phase("stream", steps: words.count) {
            for count in 1...words.count {
                vm.updateStreamingAssistantText(words.prefix(count).joined(separator: " "))
                if let scheduledID = vm.streamPacing.scheduledID {
                    vm.flushStreamingAssistantDisplay(scheduledID: scheduledID)
                }
                await Self.settle(host)
            }
        }

        // Direct calls of the function every user/assistant bubble body runs (timing bonus).
        let bubbleTexts = vm.messages
            .filter { ["user", "assistant"].contains($0.role.lowercased()) }
            .map { ChatMessageVisibleText.displayText(in: $0, includeThinking: false) }
        let passes = 20
        try await recorder.phase("bubbleScan", steps: passes * bubbleTexts.count) {
            for _ in 0..<passes {
                let started = recorder.clock.now
                var found = 0
                for text in bubbleTexts where chatFirstPreviewURL(in: text) != nil {
                    found += 1
                }
                let elapsed = started.duration(to: recorder.clock.now)
                recorder.timings["bubbleScanPassUs", default: []].append(
                    Double(elapsed.components.attoseconds) / 1e12 + Double(elapsed.components.seconds) * 1e6)
                #expect(found > 0)
            }
        }

        let baseURL = try #require(URL(string: "https://example.com/page"))
        let fixtures = [ProofFixture.openGraphHTML, ProofFixture.openGraphTitleFallbackHTML]
        let parses = 50
        var parsed = 0
        var parseResults: [String] = []
        try await recorder.phase("openGraphParse", steps: parses) {
            for index in 0..<parses {
                let started = recorder.clock.now
                let result = parseChatOpenGraph(html: fixtures[index % 2], baseURL: baseURL)
                let elapsed = started.duration(to: recorder.clock.now)
                recorder.timings["openGraphParseUs", default: []].append(
                    Double(elapsed.components.attoseconds) / 1e12 + Double(elapsed.components.seconds) * 1e6)
                if case .loaded = result { parsed += 1 }
                if index < 2 { parseResults.append(String(describing: result)) }
            }
        }
        #expect(parsed == parses)
        let rows = Self.rowFingerprints(vm)

        let rendered = vm.sourcePreviewState.previews.values.reduce(0) { $0 + $1.count }
        #expect(rendered > 0, "source cards were projected")
        let summary: [String: Any] = [
            "label": label,
            "sample": sample,
            "regexCounting": regexCounting,
            "historyRows": vm.messages.count,
            "projectedCards": rendered,
            "scrollDocumentHeight": scrollView?.documentView?.frame.height ?? 0,
            "phases": recorder.phases,
            "timings": recorder.timings,
            "bubbleTexts": bubbleTexts.count,
            "screenshotSHA256": screenshotDigest,
            "openGraphResults": parseResults.map(ProofFixture.digest),
            "openGraphResultText": parseResults,
            "rowSHA256": rows,
            "rowsSHA256": ProofFixture.digest(rows.joined(separator: "\n")),
        ]
        let data = try JSONSerialization.data(withJSONObject: summary, options: [.prettyPrinted, .sortedKeys])
        try data.write(to: outDir.appendingPathComponent("\(label)-\(sample).json"))
        print("CHAT_PERF_PROOF wrote \(label)-\(sample).json rows=\(vm.messages.count) cards=\(rendered)")
    }
}
#endif
