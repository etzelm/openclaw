import CryptoKit
import Foundation
import os
#if os(iOS)
import QuartzCore
#endif

/// Scratch call counter and interval timer. The proof rig copies this file and the same
/// probe lines into base and head before the measured build. Never part of a PR.
///
/// In the iOS app launched with `--openclaw-perf-sources-fixture` it also writes an event log to
/// `NSTemporaryDirectory()/chatperf-<pid>.txt`:
///   u|p <time> <ns> <card builds> <title renders> <excerpt renders>   one `update` / `project` call
///   c <time> <run id> <sha256>      cards of one cited reply after an `update` (only when changed)
///   n <time> <cited replies> <cards> <sha256 over all replies>       after every `update`
///   r <time> <row key> <sha256>     cards a rendered `ChatView` row received (only when changed)
///   f <time> <timestamp> <target>   one CADisplayLink callback (frame pacing)
final class ChatPerfProbe: @unchecked Sendable {
    struct Interval {
        let state: OSSignpostIntervalState
        let start: UInt64
        let cardBuilds: Int
        let titles: Int
        let excerpts: Int
    }

    private static let shared = ChatPerfProbe()
    private static let signposter = OSSignposter(subsystem: "ai.openclaw.chatperfproof", category: "update")
    private let lock = NSLock()
    private var counts: [String: Int] = [:]
    private var durations: [String: [UInt64]] = [:]
    /// Card builds that ran inside each timed call, parallel to `durations`.
    private var builds: [String: [Int]] = [:]
    private var replyDigests: [String: String] = [:]
    private var rowDigests: [String: String] = [:]
    private let logging = ProcessInfo.processInfo.arguments.contains("--openclaw-perf-sources-fixture")
    private var events: [String] = []
    private var timer: DispatchSourceTimer?
    private let logURL = URL(fileURLWithPath: NSTemporaryDirectory())
        .appendingPathComponent("chatperf-\(ProcessInfo.processInfo.processIdentifier).txt")

    private static var now: Double {
        Date().timeIntervalSince1970
    }

    @discardableResult
    static func hit(_ label: String) -> Bool {
        self.shared.lock.lock()
        self.shared.counts[label, default: 0] += 1
        self.shared.lock.unlock()
        return true
    }

    /// Opens an os_signpost interval named after `label` and starts a monotonic timer.
    static func begin(_ label: StaticString) -> Interval {
        let id = self.signposter.makeSignpostID()
        let state = self.signposter.beginInterval(label, id: id)
        let counts = self.snapshot()
        return Interval(
            state: state,
            start: DispatchTime.now().uptimeNanoseconds,
            cardBuilds: counts["cardBuild"] ?? 0,
            titles: counts["cardTitleRender"] ?? 0,
            excerpts: counts["cardExcerptRender"] ?? 0)
    }

    static func end(_ label: StaticString, _ interval: Interval) {
        let elapsed = DispatchTime.now().uptimeNanoseconds &- interval.start
        self.signposter.endInterval(label, interval.state)
        let key = "\(label)"
        let probe = self.shared
        probe.lock.lock()
        let built = (probe.counts["cardBuild"] ?? 0) - interval.cardBuilds
        probe.durations[key, default: []].append(elapsed)
        probe.builds[key, default: []].append(built)
        if probe.logging {
            let titles = (probe.counts["cardTitleRender"] ?? 0) - interval.titles
            let excerpts = (probe.counts["cardExcerptRender"] ?? 0) - interval.excerpts
            let kind = key == "project" ? "p" : "u"
            probe.events.append("\(kind) \(self.now) \(elapsed) \(built) \(titles) \(excerpts)")
        }
        probe.lock.unlock()
    }

    private static func digest(_ text: String) -> String {
        SHA256.hash(data: Data(text.utf8)).map { String(format: "%02x", $0) }.joined()
    }

    private static func describe(_ cards: [ChatSourcePreview]) -> String {
        cards.map { card in
            let kind = card.excerptKind.map { "\($0)" } ?? "-"
            let cited = card.citedURLs.map(\.absoluteString).joined(separator: ",")
            return "\(card.url.absoluteString)|\(card.title)|\(card.domain)|\(card.excerpt ?? "-")|\(kind)|\(cited)"
        }.joined(separator: "\n")
    }

    /// Called after `ChatSourcePreviewState.update` returns (outside its timed interval).
    static func cards(_ messages: [OpenClawChatMessage], _ previews: [UUID: [ChatSourcePreview]]) {
        let probe = self.shared
        guard probe.logging else { return }
        probe.startFlushing()
        var lines: [String] = []
        var all: [String] = []
        var cards = 0
        let time = self.now
        probe.lock.lock()
        for message in messages {
            guard let cardsForReply = previews[message.id], !cardsForReply.isEmpty else { continue }
            let key = message.transcriptRunID ?? message.id.uuidString
            let sha = self.digest(self.describe(cardsForReply))
            cards += cardsForReply.count
            all.append("\(key)=\(sha)")
            if probe.replyDigests[key] != sha {
                probe.replyDigests[key] = sha
                lines.append("c \(time) \(key) \(sha)")
            }
        }
        lines.append("n \(time) \(all.count) \(cards) \(self.digest(all.joined(separator: "\n")))")
        probe.events += lines
        probe.lock.unlock()
    }

    /// Wraps the `sourcePreviews:` argument of `ChatView.messageRow` on base and head alike.
    @MainActor
    static func messageRow(
        _ message: OpenClawChatMessage,
        _ body: () -> [ChatSourcePreview]) -> [ChatSourcePreview]
    {
        let result = body()
        let probe = self.shared
        guard probe.logging else { return result }
        #if os(iOS)
        ChatPerfFrameRecorder.shared.start()
        #endif
        let key = [
            message.transcriptRunID ?? "-",
            message.role,
            message.presentationBlockIndex.map(String.init) ?? "whole",
        ].joined(separator: "#")
        let sha = self.digest(self.describe(result))
        probe.lock.withLock {
            if probe.rowDigests[key] != sha {
                probe.rowDigests[key] = sha
                probe.events.append("r \(self.now) \(key) \(sha) \(result.count)")
            }
        }
        return result
    }

    static func record(_ line: String) {
        let probe = self.shared
        guard probe.logging else { return }
        probe.lock.withLock { probe.events.append(line) }
    }

    private func startFlushing() {
        self.lock.lock()
        defer { self.lock.unlock() }
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

    static func snapshot() -> [String: Int] {
        self.shared.lock.lock()
        defer { self.shared.lock.unlock() }
        return self.shared.counts
    }

    static func builds(_ label: String) -> [Int] {
        self.shared.lock.lock()
        defer { self.shared.lock.unlock() }
        return self.shared.builds[label] ?? []
    }

    static func durations(_ label: String) -> [UInt64] {
        self.shared.lock.lock()
        defer { self.shared.lock.unlock() }
        return self.shared.durations[label] ?? []
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
