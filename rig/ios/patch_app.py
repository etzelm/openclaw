#!/usr/bin/env python3
"""Scratch-only changes to the shipped iOS app for the p2 native proof (openclaw/openclaw#193863).
Applied identically to base and head.

Usage: patch_app.py <repo root>
1. AppleReviewDemoChatTransport.swift (the app's local demo/fixture chat transport): with
   `--openclaw-perf-sources-fixture`, the demo store seeds 80 cited agent turns and, once the chat has
   loaded them, plays a fixed script of gateway events through the transport's real event stream:
   21 persisted messages as `.sessionMessage` events (7 turns), 10 `sessions.changed` (phase "message")
   history refreshes that each return the same rows plus one new row, and 10 `.chatMetadataChanged`
   events, each making the chat reload the source context through `loadSourceContext()` (alternating
   between a gateway context and none). Each step is timestamped to tmp/chatperf-marks.txt.
2. OpenClawSnapshotUITests.swift: one scratch UI test that launches the app with the fixture, waits for
   the transcript, waits out the script and takes screenshots. It never types or taps.
3. project.yml: drops the SwiftFormat/SwiftLint pre-build phases (they would lint the scratch code).
4. Xcode 26 compile compatibility (hosted runners have no Xcode 27): the iOS 27.1-only branches are
   wrapped in `#if compiler(>=6.4)`; see compat_xcode26().
Every anchor must match exactly once, so base and head get the same edits or the job fails.
"""
import sys
from pathlib import Path

ROOT = Path(sys.argv[1])
IOS = ROOT / "apps/ios"


def replace_once(path, old, new):
    text = path.read_text()
    if text.count(old) != 1:
        sys.exit(f"patch_app: {path.name}: anchor matched {text.count(old)} times: {old[:60]!r}")
    path.write_text(text.replace(old, new))
    print(f"patched {path.relative_to(ROOT)}")


FIXTURE = r'''

/// Scratch proof fixture (never part of a PR): cited agent turns and a scripted event sequence.
enum ChatPerfFixture {
    static let runs = 80
    static let appendedTurns = 7
    static let refreshes = 10
    static let contextChanges = 10
    static let epochMs = 1_790_000_000_000.0
    static let gateway = "https://gateway.proof.invalid"
    static let enabled = ProcessInfo.processInfo.arguments.contains("--openclaw-perf-sources-fixture")
    static let context = OpenClawChatSourceContext(gatewayURL: URL(string: gateway + "/")!, basePath: "")

    private static let marksURL = URL(fileURLWithPath: NSTemporaryDirectory()).appendingPathComponent("chatperf-marks.txt")

    static func mark(_ text: String) {
        let line = "m \(Date().timeIntervalSince1970) \(text)\n"
        if let handle = try? FileHandle(forWritingTo: self.marksURL) {
            _ = try? handle.seekToEnd()
            try? handle.write(contentsOf: Data(line.utf8))
            try? handle.close()
        } else {
            try? line.write(to: self.marksURL, atomically: true, encoding: .utf8)
        }
    }

    private static func wrap(_ text: String) -> String {
        """
        <<<EXTERNAL_UNTRUSTED_CONTENT id="0123456789abcdef">>>
        Source: Web Search
        ---
        \(text)
        <<<END_EXTERNAL_UNTRUSTED_CONTENT id="0123456789abcdef">>>
        """
    }

    private static func details(_ rows: [[String: Any]]) -> AnyCodable? {
        let object: [String: Any] = [
            "kind": "results", "results": rows,
            "externalContent": ["source": "web_search", "untrusted": true, "wrapped": true],
        ]
        guard let data = try? JSONSerialization.data(withJSONObject: object) else { return nil }
        return try? JSONDecoder().decode(AnyCodable.self, from: data)
    }

    /// Question, web_search result and cited answer. The fourth cited link is a gateway chat route:
    /// its card shows without a source context and is hidden under the gateway context.
    static func turn(_ index: Int) -> [OpenClawChatMessage] {
        let runID = "perf-run-\(index)"
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
        let text = "Recorded findings with **emphasis** for marker-\(index).\n\n" +
            "See [one](\(urls[0])), [two](\(urls[1])), [three](\(urls[2])) and [session](\(urls[3]))."
        return [
            OpenClawChatMessage(
                role: "user",
                content: [OpenClawChatMessageContent(type: "text", text: "Question \(index): what changed?")],
                timestamp: start,
                transcriptMessageID: "perf-question-\(index)"),
            OpenClawChatMessage(
                role: "toolResult", content: [], timestamp: start + 1000,
                transcriptMessageID: "perf-result-\(index)", transcriptRunID: runID,
                toolCallId: "call-\(index)", toolName: "web_search", details: self.details(rows)),
            OpenClawChatMessage(
                role: "assistant",
                content: [
                    OpenClawChatMessageContent(type: "toolCall", id: "call-\(index)", name: "web_search"),
                    OpenClawChatMessageContent(type: "tool_result", text: "Recorded", id: "call-\(index)"),
                    OpenClawChatMessageContent(type: "text", text: text),
                ],
                timestamp: start + 2000,
                transcriptMessageID: "perf-answer-\(index)",
                transcriptRunID: runID,
                stopReason: "stop",
                phase: "final_answer"),
        ]
    }

    static func history() -> [OpenClawChatMessage] {
        (0..<self.runs).flatMap(self.turn)
    }

    static func otherDeviceRow(_ index: Int) -> OpenClawChatMessage {
        OpenClawChatMessage(
            role: "user",
            content: [OpenClawChatMessageContent(type: "text", text: "Follow-up \(index) from another device.")],
            timestamp: self.epochMs + Double(self.runs + self.appendedTurns + index) * 60000,
            transcriptMessageID: "perf-other-\(index)")
    }
}
'''

STORE = r'''
    // Scratch proof script (never part of a PR).
    private var perfSessionKey: String?
    private var perfScriptStarted = false
    private var perfSourceContext: OpenClawChatSourceContext?

    func perfContext() -> OpenClawChatSourceContext? {
        self.perfSourceContext
    }

    private func perfStartScriptIfReady() {
        guard ChatPerfFixture.enabled, !self.perfScriptStarted, self.perfSessionKey != nil,
              !self.eventContinuations.isEmpty else { return }
        self.perfScriptStarted = true
        Task { await self.perfRunScript() }
    }

    private func perfRunScript() async {
        guard let key = self.perfSessionKey else { return }
        ChatPerfFixture.mark("load served")
        try? await Task.sleep(for: .seconds(6))
        let appended = (0..<ChatPerfFixture.appendedTurns).flatMap { ChatPerfFixture.turn(ChatPerfFixture.runs + $0) }
        for (index, message) in appended.enumerated() {
            self.messages.append(message)
            ChatPerfFixture.mark("step append \(index)")
            self.publish(.sessionMessage(OpenClawSessionMessageEventPayload(
                sessionKey: key, message: message, messageId: message.transcriptMessageID, messageSeq: nil)))
            try? await Task.sleep(for: .milliseconds(900))
        }
        try? await Task.sleep(for: .seconds(2))
        for index in 0..<ChatPerfFixture.refreshes {
            self.messages.append(ChatPerfFixture.otherDeviceRow(index))
            ChatPerfFixture.mark("step refresh \(index)")
            self.publish(.sessionsChanged(OpenClawChatSessionsChangedEvent(
                sessionKey: key, reason: "message", phase: "message")))
            try? await Task.sleep(for: .milliseconds(1500))
        }
        try? await Task.sleep(for: .seconds(2))
        for index in 0..<ChatPerfFixture.contextChanges {
            self.perfSourceContext = index % 2 == 0 ? ChatPerfFixture.context : nil
            ChatPerfFixture.mark("step context \(index)")
            self.publish(.chatMetadataChanged(modelCatalogChanged: false))
            try? await Task.sleep(for: .milliseconds(1500))
        }
        try? await Task.sleep(for: .seconds(2))
        ChatPerfFixture.mark("done")
    }
'''

UI_TESTS = r'''

    // Scratch proof test (never part of a PR): the app's demo transport plays the event script.
    func testScratchSourcePreviewProof() throws {
        print("CHATPERF_MARK launch \(Date().timeIntervalSince1970)")
        self.launchApp(for: Self.chatScreenshotTarget, additionalArguments: ["--openclaw-perf-sources-fixture"])
        let app = try XCTUnwrap(self.app)
        let transcript = try self.chatTranscript(in: app)
        let latest = transcript.descendants(matching: .any)
            .matching(NSPredicate(format: "label CONTAINS %@", "marker-79")).firstMatch
        XCTAssertTrue(latest.waitForExistence(timeout: 60), "latest cited answer missing")
        print("CHATPERF_MARK loaded \(Date().timeIntervalSince1970)")
        self.attachScreenshot(named: "sources-loaded")
        // Script: 6 s settle, 21 appends x 0.9 s, 10 refreshes x 1.5 s, 10 context changes x 1.5 s.
        // Fixed sleeps, no UI queries while it runs; the rig checks the app's own step log.
        Thread.sleep(forTimeInterval: 28)
        self.attachScreenshot(named: "sources-after-appends")
        Thread.sleep(forTimeInterval: 40)
        self.attachScreenshot(named: "sources-end")
        print("CHATPERF_DONE \(Date().timeIntervalSince1970)")
    }
'''
COMPAT = [
    ("apps/ios/Sources/Design/OpenClawProComponents.swift",
     "        if #available(iOS 27.1, *) {\n"
     "            self.item.axisBehavior(.verticalPreferred).visibilityPriority(.high)\n"
     "        } else {\n"
     "            self.item\n"
     "        }\n"),
    ("apps/ios/Sources/Design/ChatProTab.swift",
     "                    if #available(iOS 27.1, *) {\n"
     "                        // Custom controls must explicitly support the system's side bar.\n"
     "                        self.chatToolbar.axisBehavior(.verticalPreferred)\n"
     "                    } else {\n"
     "                        self.chatToolbar\n"
     "                    }\n"),
    ("apps/ios/Sources/Design/ChatProTab.swift",
     "        if #available(iOS 27.1, *) {\n"
     "            self.headerAgentIdentityButton.modifier(ChatToolbarStatusPopover(\n"
     "                isExpanded: self.$isGatewayStatusManuallyExpanded,\n"
     "                status: self.expandedGatewayStatusLabel))\n"
     "        } else {\n"
     "            self.headerAgentIdentityButton\n"
     "        }\n"),
]


def compat_xcode26():
    """Xcode 26 cannot compile the iOS 27.1-only branches (iOS 27.1 SDK symbols). Wrap exactly those
    branches in `#if compiler(>=6.4)`: an Xcode 27 build sees the original source, and on an iOS 26
    simulator the `else` branch is the one that runs either way."""
    for name, block in COMPAT:
        path = ROOT / name
        indent = block[: len(block) - len(block.lstrip())]
        fallback = block.split("} else {\n", 1)[1].rsplit("}", 1)[0]
        fallback = "\n".join(line[4:] for line in fallback.rstrip("\n").split("\n")) + "\n"
        replace_once(path, block, "#if compiler(>=6.4)\n" + block + "#else\n" + fallback + "#endif\n")
    path = ROOT / "apps/ios/Sources/Design/ChatProTab.swift"
    lines = path.read_text().split("\n")
    start = [i for i, line in enumerate(lines) if line == "@available(iOS 27.1, *)"
             and lines[i + 1].startswith("private struct ChatToolbarStatusPopover")]
    if len(start) != 1:
        sys.exit("patch_app: ChatToolbarStatusPopover anchor")
    end = next(i for i in range(start[0] + 1, len(lines)) if lines[i] == "}")
    lines[end] += "\n#endif"
    lines[start[0]] = "#if compiler(>=6.4)\n" + lines[start[0]]
    path.write_text("\n".join(lines))
    print("patched ChatProTab.swift (ChatToolbarStatusPopover under compiler(>=6.4))")


def main():
    transport = IOS / "Sources/Chat/AppleReviewDemoChatTransport.swift"
    replace_once(
        transport,
        "    private static func seedMessages(fixture: LocalChatFixture) -> [OpenClawChatMessage] {\n",
        "    private static func seedMessages(fixture: LocalChatFixture) -> [OpenClawChatMessage] {\n"
        "        if ChatPerfFixture.enabled {\n"
        "            return ChatPerfFixture.history()\n"
        "        }\n")
    replace_once(
        transport,
        "    func requestHistory(sessionKey: String) async throws -> OpenClawChatHistoryPayload {\n"
        "        try await self.store.history(sessionKey: sessionKey)\n    }\n",
        "    func requestHistory(sessionKey: String) async throws -> OpenClawChatHistoryPayload {\n"
        "        try await self.store.history(sessionKey: sessionKey)\n    }\n\n"
        "    func loadSourceContext() async -> OpenClawChatSourceContext? {\n"
        "        await self.store.perfContext()\n    }\n")
    replace_once(
        transport,
        "    func history(sessionKey: String) throws -> OpenClawChatHistoryPayload {\n",
        "    func history(sessionKey: String) throws -> OpenClawChatHistoryPayload {\n"
        "        if ChatPerfFixture.enabled, self.perfSessionKey == nil {\n"
        "            self.perfSessionKey = sessionKey\n"
        "            self.perfStartScriptIfReady()\n"
        "        }\n")
    replace_once(
        transport,
        "        continuation.onTermination = { [weak self] _ in\n"
        "            Task { await self?.removeEventContinuation(id) }\n        }\n    }\n",
        "        continuation.onTermination = { [weak self] _ in\n"
        "            Task { await self?.removeEventContinuation(id) }\n        }\n"
        "        self.perfStartScriptIfReady()\n    }\n" + STORE)
    transport.write_text(transport.read_text() + FIXTURE)

    tests = IOS / "UITests/OpenClawSnapshotUITests.swift"
    anchor = ("    func testReleaseControlScreenshot() {\n"
              "        self.captureReleaseScreenshot(Self.controlScreenshotTarget)\n    }\n")
    replace_once(tests, anchor, anchor + UI_TESTS)

    project = IOS / "project.yml"
    lines = project.read_text().split("\n")
    start = next(i for i, line in enumerate(lines)
                 if line == "    preBuildScripts:" and lines[i + 1] == "      - name: SwiftFormat (lint)")
    end = next(i for i in range(start + 1, len(lines)) if lines[i].startswith("    ") and not lines[i].startswith("     "))
    removed = lines[start:end]
    if sum(1 for line in removed if line.startswith("      - name:")) != 2 or "SwiftLint" not in "\n".join(removed):
        sys.exit("patch_app: project.yml lint phases not as expected")
    project.write_text("\n".join(lines[:start] + lines[end:]))
    print(f"patched apps/ios/project.yml (removed lines {start + 1}..{end})")
    compat_xcode26()


if __name__ == "__main__":
    main()
