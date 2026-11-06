import Foundation
import os

/// Scratch call counter and interval timer. The proof rig copies this file and the same
/// probe lines into base and head before the measured build. Never part of a PR.
final class ChatPerfProbe: @unchecked Sendable {
    struct Interval {
        let state: OSSignpostIntervalState
        let start: UInt64
        let cardBuilds: Int
    }

    private static let shared = ChatPerfProbe()
    private static let signposter = OSSignposter(subsystem: "ai.openclaw.chatperfproof", category: "update")
    private let lock = NSLock()
    private var counts: [String: Int] = [:]
    private var durations: [String: [UInt64]] = [:]
    /// Card builds that ran inside each timed call, parallel to `durations`.
    private var builds: [String: [Int]] = [:]

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
        let cardBuilds = self.snapshot()["cardBuild"] ?? 0
        return Interval(state: state, start: DispatchTime.now().uptimeNanoseconds, cardBuilds: cardBuilds)
    }

    static func end(_ label: StaticString, _ interval: Interval) {
        let elapsed = DispatchTime.now().uptimeNanoseconds &- interval.start
        self.signposter.endInterval(label, interval.state)
        let key = "\(label)"
        self.shared.lock.lock()
        self.shared.durations[key, default: []].append(elapsed)
        self.shared.builds[key, default: []].append((self.shared.counts["cardBuild"] ?? 0) - interval.cardBuilds)
        self.shared.lock.unlock()
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
