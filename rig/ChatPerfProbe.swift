import Foundation

/// Scratch call counter. The proof rig copies this file and the same probe
/// lines into base and head before the measured build. Never part of a PR.
final class ChatPerfProbe: @unchecked Sendable {
    private static let shared = ChatPerfProbe()
    private let lock = NSLock()
    private var counts: [String: Int] = [:]

    @discardableResult
    static func hit(_ label: String) -> Bool {
        self.shared.lock.lock()
        self.shared.counts[label, default: 0] += 1
        self.shared.lock.unlock()
        return true
    }

    static func snapshot() -> [String: Int] {
        self.shared.lock.lock()
        defer { self.shared.lock.unlock() }
        return self.shared.counts
    }
}
