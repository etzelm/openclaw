import Foundation
#if os(iOS)
import QuartzCore
#endif

/// Scratch call counter. The proof rig copies this file and the same probe
/// lines into base and head before the measured build. Never part of a PR.
///
/// Every hit is counted under its label. A hit that happens while
/// `ChatView.messageRow` is evaluating its source cards is also counted as
/// `<label>@messageRow`, so the counts show which work runs on that path.
/// In the iOS app (launched with `--openclaw-perf-citations-fixture`) the probe also
/// writes timestamped events, the main-thread time of each `sourcePreviews:` call and
/// display-link frames to `NSTemporaryDirectory()/chatperf-<pid>.txt`.
final class ChatPerfProbe: @unchecked Sendable {
    private static let shared = ChatPerfProbe()
    private static let tracked: Set<String> = [
        "messageRow.splitRow", "messageRow.wholeRow",
        "rowSourcePreviews@messageRow", "citationParse@messageRow",
        "previewURLDocumentParse@messageRow", "citationParse", "previewURLDocumentParse",
    ]
    private let lock = NSLock()
    private var counts: [String: Int] = [:]
    private var rowDepth = 0
    /// Last rendered cards per stable row key, and how often a row's cards changed between renders.
    private var rows: [String: String] = [:]
    private var rowChanges = 0
    private let logging = ProcessInfo.processInfo.arguments.contains("--openclaw-perf-citations-fixture")
    private var events: [String] = []
    private var timer: DispatchSourceTimer?
    private let logURL = URL(fileURLWithPath: NSTemporaryDirectory())
        .appendingPathComponent("chatperf-\(ProcessInfo.processInfo.processIdentifier).txt")

    private static var now: Double {
        Date().timeIntervalSince1970
    }

    @discardableResult
    static func hit(_ label: String) -> Bool {
        let probe = self.shared
        probe.lock.lock()
        probe.counts[label, default: 0] += 1
        let inRow = probe.rowDepth > 0
        if inRow {
            probe.counts[label + "@messageRow", default: 0] += 1
        }
        if probe.logging {
            let time = self.now
            if self.tracked.contains(label) { probe.events.append("e \(time) \(label)") }
            if inRow, self.tracked.contains(label + "@messageRow") { probe.events.append("e \(time) \(label)@messageRow") }
        }
        probe.lock.unlock()
        return true
    }

    static func record(_ line: String) {
        let probe = self.shared
        guard probe.logging else { return }
        probe.lock.withLock { probe.events.append(line) }
    }

    private func startFlushing() {
        guard self.logging, self.timer == nil else { return }
        let header = "h \(Self.now) " + ProcessInfo.processInfo.arguments.joined(separator: " ") + "\n"
        try? header.write(to: self.logURL, atomically: true, encoding: .utf8)
        let timer = DispatchSource.makeTimerSource(queue: .global(qos: .utility))
        timer.schedule(deadline: .now() + 0.2, repeating: 0.2)
        timer.setEventHandler { [self] in self.flush() }
        timer.resume()
        self.timer = timer
    }

    private func flush() {
        let lines: [String] = self.lock.withLock {
            defer { self.events.removeAll(keepingCapacity: true) }
            return self.events
        }
        guard !lines.isEmpty, let handle = try? FileHandle(forWritingTo: self.logURL) else { return }
        defer { try? handle.close() }
        _ = try? handle.seekToEnd()
        try? handle.write(contentsOf: Data((lines.joined(separator: "\n") + "\n").utf8))
    }

    /// Wraps the `sourcePreviews:` argument of `ChatView.messageRow` on base and head alike.
    @MainActor
    static func messageRow(
        _ message: OpenClawChatMessage,
        _ body: () -> [ChatSourcePreview]) -> [ChatSourcePreview]
    {
        let probe = self.shared
        if probe.logging {
            probe.lock.withLock { probe.startFlushing() }
            #if os(iOS)
            ChatPerfFrameRecorder.shared.start()
            #endif
        }
        let split = message.presentationBlockIndex != nil
        self.hit(split ? "messageRow.splitRow" : "messageRow.wholeRow")
        probe.lock.withLock { probe.rowDepth += 1 }
        let started = DispatchTime.now().uptimeNanoseconds
        let result = body()
        let elapsed = DispatchTime.now().uptimeNanoseconds - started
        let key = [
            message.transcriptRunID ?? "-",
            message.role,
            message.presentationBlockIndex.map(String.init) ?? "whole",
        ].joined(separator: "#")
        let value = result.map { card in
            [card.url.absoluteString, card.title, card.domain, card.excerpt ?? ""].joined(separator: " | ")
        }.joined(separator: "\n")
        probe.lock.withLock {
            probe.rowDepth -= 1
            let previous = probe.rows[key]
            if let previous, previous != value { probe.rowChanges += 1 }
            probe.rows[key] = value
            if probe.logging {
                probe.events.append("d \(Self.now) \(split ? "split" : "whole") \(elapsed)")
                if previous != value {
                    probe.events.append("r \(Self.now) \(key)\t" + value.replacingOccurrences(of: "\n", with: " || "))
                }
            }
        }
        if split { self.hit(result.isEmpty ? "messageRow.splitRow.noCards" : "messageRow.splitRow.withCards") }
        return result
    }

    static func snapshot() -> [String: Int] {
        self.shared.lock.lock()
        defer { self.shared.lock.unlock() }
        return self.shared.counts
    }

    static func resetRows() {
        self.shared.lock.withLock {
            self.shared.rows = [:]
            self.shared.rowChanges = 0
        }
    }

    static func renderedRows() -> (rows: [String: String], changes: Int) {
        self.shared.lock.lock()
        defer { self.shared.lock.unlock() }
        return (self.shared.rows, self.shared.rowChanges)
    }
}

#if os(iOS)
/// Records every display-link callback on the main run loop. A late callback means the
/// main thread was busy past a frame deadline; the rig turns the gaps into hitch numbers.
@MainActor
final class ChatPerfFrameRecorder: NSObject {
    static let shared = ChatPerfFrameRecorder()
    private var link: CADisplayLink?

    func start() {
        guard self.link == nil else { return }
        let link = CADisplayLink(target: self, selector: #selector(self.tick(_:)))
        link.preferredFrameRateRange = CAFrameRateRange(minimum: 60, maximum: 60, preferred: 60)
        link.add(to: .main, forMode: .common)
        self.link = link
    }

    @objc private func tick(_ link: CADisplayLink) {
        ChatPerfProbe.record("f \(Date().timeIntervalSince1970) \(link.timestamp) \(link.targetTimestamp)")
    }
}
#endif
