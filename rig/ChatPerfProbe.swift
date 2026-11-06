import Foundation

/// Scratch call counter. The proof rig copies this file and the same probe
/// lines into base and head before the measured build. Never part of a PR.
///
/// Every hit is counted under its label. A hit that happens while
/// `ChatView.messageRow` is evaluating its source cards is also counted as
/// `<label>@messageRow`, so the counts show which work runs on that path.
final class ChatPerfProbe: @unchecked Sendable {
    private static let shared = ChatPerfProbe()
    private let lock = NSLock()
    private var counts: [String: Int] = [:]
    private var rowDepth = 0
    /// Last rendered cards per stable row key, and how often a row's cards changed between renders.
    private var rows: [String: String] = [:]
    private var rowChanges = 0

    @discardableResult
    static func hit(_ label: String) -> Bool {
        self.shared.lock.lock()
        self.shared.counts[label, default: 0] += 1
        if self.shared.rowDepth > 0 {
            self.shared.counts[label + "@messageRow", default: 0] += 1
        }
        self.shared.lock.unlock()
        return true
    }

    /// Wraps the `sourcePreviews:` argument of `ChatView.messageRow` on base and head alike.
    @MainActor
    static func messageRow(
        _ message: OpenClawChatMessage,
        _ body: () -> [ChatSourcePreview]) -> [ChatSourcePreview]
    {
        let split = message.presentationBlockIndex != nil
        self.hit(split ? "messageRow.splitRow" : "messageRow.wholeRow")
        self.shared.lock.withLock { self.shared.rowDepth += 1 }
        let result = body()
        let key = [
            message.transcriptRunID ?? "-",
            message.role,
            message.presentationBlockIndex.map(String.init) ?? "whole",
        ].joined(separator: "#")
        let value = result.map { card in
            [card.url.absoluteString, card.title, card.domain, card.excerpt ?? ""].joined(separator: " | ")
        }.joined(separator: "\n")
        self.shared.lock.withLock {
            self.shared.rowDepth -= 1
            if let previous = self.shared.rows[key], previous != value { self.shared.rowChanges += 1 }
            self.shared.rows[key] = value
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
