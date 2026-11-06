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

    /// One agent turn: question, web_search result (when `withSources`), cited answer that splits
    /// into three presentation parts. Without the result row the same answer has no source cards.
    static func turn(_ index: Int, withSources: Bool) -> [OpenClawChatMessage] {
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
            count: 4)
        let answer = "\(paragraph)\n\nSee [one](\(urls[0])), [two](\(urls[1])) and [three](\(urls[2])). " +
            "Raw link https://example9.com/raw-\(index) for later.\n\n\(paragraph)"
        let question = OpenClawChatMessage(
            role: "user",
            content: [.init(type: "text", text: "Question \(index): what changed in https://example.org/q-\(index)?")],
            timestamp: start)
        let result = OpenClawChatMessage(
            role: "toolResult", content: [], timestamp: start + 1000, transcriptRunID: runID,
            toolCallId: "call-\(index)", toolName: "web_search",
            details: AnyCodable([
                "kind": "results", "results": rows,
                "externalContent": ["source": "web_search", "untrusted": true, "wrapped": true],
            ] as [String: Any]))
        return [question] + (withSources ? [result] : []) + [
            OpenClawChatMessage(role: "assistant", content: [
                .init(type: "toolCall", id: "call-\(index)", name: "web_search"),
                .init(type: "tool_result", text: "Recorded", id: "call-\(index)"),
                .init(type: "text", text: answer),
                .init(type: "toolCall", id: "next-\(index)", name: "read"),
                .init(type: "tool_result", text: "Recorded next", id: "next-\(index)"),
            ], timestamp: start + 2000, transcriptRunID: runID, phase: "final_answer"),
        ]
    }

    static func history(withSources: Bool) throws -> [AnyCodable] {
        let messages = (0..<self.runs).flatMap { self.turn($0, withSources: withSources) }
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
}

@MainActor
private final class ProofRecorder {
    let label: String
    let signposter = OSSignposter(subsystem: "ai.openclaw.chatperfproof", category: "workload")
    var phases: [[String: Any]] = []
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
    static let windowHeight: CGFloat = 1000
    @MainActor static var profilerWaited = false

    /// For the trace step: publish the pid, then wait (bounded) until the profiler has attached.
    @MainActor private static func waitForProfilerIfRequested() async {
        guard !self.profilerWaited, let dir = self.environment["CHAT_PERF_ATTACH_DIR"] else { return }
        self.profilerWaited = true
        let pidFile = URL(fileURLWithPath: dir).appendingPathComponent("pid")
        let goFile = URL(fileURLWithPath: dir).appendingPathComponent("go")
        try? "\(ProcessInfo.processInfo.processIdentifier)".write(to: pidFile, atomically: true, encoding: .utf8)
        let deadline = Date().addingTimeInterval(90)
        while !FileManager.default.fileExists(atPath: goFile.path), Date() < deadline {
            try? await Task.sleep(for: .milliseconds(100))
        }
    }

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

    @MainActor private static func snapshot(_ view: NSView, to url: URL) {
        guard let rep = view.bitmapImageRepForCachingDisplay(in: view.bounds) else { return }
        view.cacheDisplay(in: view.bounds, to: rep)
        try? rep.representation(using: .png, properties: [:])?.write(to: url)
    }

    @Test(.enabled(if: Self.enabled), arguments: [true, false])
    @MainActor func `shared chat view renders a cited transcript`(withSources: Bool) async throws {
        let outDir = URL(fileURLWithPath: Self.environment["CHAT_PERF_OUT"] ?? NSTemporaryDirectory())
        let label = Self.environment["CHAT_PERF_LABEL"] ?? "local"
        let sample = Self.environment["CHAT_PERF_SAMPLE"] ?? "0"
        let variant = withSources ? "cards" : "nocards"
        if let only = Self.environment["CHAT_PERF_ONLY"], only != variant { return }
        try FileManager.default.createDirectory(at: outDir, withIntermediateDirectories: true)
        let regexCounting = RegexCompileCounter.installed

        _ = NSApplication.shared
        let transport = try ProofTransport(history: ProofFixture.history(withSources: withSources))
        let vm = OpenClawChatViewModel(sessionKey: "main", transport: transport)
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 960, height: Self.windowHeight),
            styleMask: [.titled, .closable, .resizable],
            backing: .buffered,
            defer: false)
        window.isReleasedWhenClosed = false
        // Same configuration as the macOS Quick Chat reply area: desktop layout folds completed
        // work, which is what splits an answer into presentation rows.
        let host = NSHostingView(rootView: OpenClawChatView(
            viewModel: vm,
            displayOptions: [],
            showsAssistantAvatars: false,
            composerChrome: .clean,
            showsComposer: false,
            isComposerEnabled: false,
            isAttachmentInputEnabled: false)
            .environment(\.openClawChatDesktopLayout, true))
        window.contentView = host
        defer {
            vm.detachTransport()
            window.contentView = nil
            window.close()
        }
        ChatPerfProbe.resetRows()
        await Self.waitForProfilerIfRequested()
        let recorder = ProofRecorder(label: "\(label) \(variant)")
        let expectedRows = ProofFixture.runs * (withSources ? 3 : 2)
        var loaded = false

        try await recorder.phase("load", steps: 1) {
            await Self.settle(host)
            if transport.historyRequests == 0 { vm.load() }
            loaded = await Self.waitUntil(host, seconds: 30) { vm.messages.count >= expectedRows }
            await Self.settle(host)
        }
        #expect(loaded, "history rows loaded: \(vm.messages.count)")
        Self.snapshot(host, to: outDir.appendingPathComponent("\(label)-\(sample)-\(variant)-latest.png"))

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
        Self.snapshot(host, to: outDir.appendingPathComponent("\(label)-\(sample)-\(variant)-transcript.png"))

        let widths: [CGFloat] = [720, 1120, 840, 960]
        try await recorder.phase("resize", steps: widths.count) {
            for width in widths {
                window.setContentSize(NSSize(width: width, height: Self.windowHeight))
                await Self.settle(host)
            }
        }

        try await recorder.phase("append", steps: ProofFixture.appended) {
            for offset in 0..<ProofFixture.appended {
                vm.replaceMessages(vm.messages + ProofFixture.turn(ProofFixture.runs + offset, withSources: withSources))
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


        let rendered = vm.sourcePreviewState.previews.values.reduce(0) { $0 + $1.count }
        let (rows, rowChanges) = ChatPerfProbe.renderedRows()
        let rowLines = rows.keys.sorted().map { key in "\(key)\n\(rows[key] ?? "")" }
        let rowHash = SHA256.hash(data: Data(rowLines.joined(separator: "\n\n").utf8))
            .map { String(format: "%02x", $0) }.joined()
        let splitRows = rows.keys.filter { !$0.hasSuffix("#whole") }
        let splitRowsWithCards = splitRows.filter { rows[$0]?.isEmpty == false }
        #expect(!splitRows.isEmpty, "messageRow rendered split rows")
        try rowLines.joined(separator: "\n\n").write(
            to: outDir.appendingPathComponent("\(label)-\(sample)-\(variant)-rows.txt"), atomically: true, encoding: .utf8)
        #expect((rendered > 0) == withSources, "source cards projected: \(rendered)")
        let summary: [String: Any] = [
            "label": label,
            "sample": sample,
            "variant": variant,
            "regexCounting": regexCounting,
            "historyRows": vm.messages.count,
            "projectedCards": rendered,
            "renderedRowKeys": rows.count,
            "renderedSplitRows": splitRows.count,
            "renderedSplitRowsWithCards": splitRowsWithCards.count,
            "renderedRowCardChanges": rowChanges,
            "renderedRowsSHA256": rowHash,
            "scrollDocumentHeight": scrollView?.documentView?.frame.height ?? 0,
            "phases": recorder.phases,
        ]
        let data = try JSONSerialization.data(withJSONObject: summary, options: [.prettyPrinted, .sortedKeys])
        try data.write(to: outDir.appendingPathComponent("\(label)-\(sample)-\(variant).json"))
        print("CHAT_PERF_PROOF wrote \(label)-\(sample)-\(variant).json rows=\(vm.messages.count) cards=\(rendered) " +
            "splitRows=\(splitRows.count) splitRowsWithCards=\(splitRowsWithCards.count) rowsSHA256=\(rowHash)")
    }
}
#endif
