#!/usr/bin/env python3
"""Scratch-only changes to the iOS app for the p1 native proof. Applied identically to base and head.

Usage: patch_app.py <repo root>
1. AppleReviewDemoChatTransport.swift: with `--openclaw-perf-citations-fixture cards|nocards`, the local
   demo chat store seeds 60 agent turns (cited answers split around tool work, with or without
   web_search results) and answers each sent message with one more such turn.
2. OpenClawSnapshotUITests.swift: two scratch UI tests (cards / nocards) that load, scroll, append.
3. project.yml: drops the SwiftFormat/SwiftLint pre-build phases (they would lint the scratch code;
   the PR's own code is linted by upstream CI). Nothing else in the project changes.
4. Xcode 26 compile compatibility (hosted runners have no Xcode 27): the four iOS 27.1-only branches
   are wrapped in `#if compiler(>=6.4)`; see compat_xcode26().
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

/// Scratch proof fixture (never part of a PR): cited answers split around tool work.
enum ChatPerfFixture {
    static let runs = 60
    static let epochMs = 1_790_000_000_000.0

    static var variant: String? {
        let arguments = ProcessInfo.processInfo.arguments
        guard let index = arguments.firstIndex(of: "--openclaw-perf-citations-fixture"),
              arguments.indices.contains(index + 1)
        else { return nil }
        return arguments[index + 1]
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

    /// Optional web_search result plus the cited answer for one run.
    static func answer(_ index: Int, tag: String, withSources: Bool, timestamp: Double) -> [OpenClawChatMessage] {
        let runID = "perf-run-\(tag)"
        let urls = (0..<3).map { "https://example\($0).com/article-\(tag)" }
        let rows: [[String: Any]] = urls.enumerated().map { offset, url in
            [
                "url": url,
                "title": self.wrap("Result \(offset) for question \(tag)"),
                "snippet": self.wrap("Snippet \(offset) with **findings** for question \(tag) and a [reference](\(url))."),
            ]
        }
        let paragraph = String(
            repeating: "This paragraph summarizes recorded findings with **emphasis** and plain prose. ",
            count: 4)
        let text = "\(paragraph)\n\nSee [one](\(urls[0])), [two](\(urls[1])) and [three](\(urls[2])). " +
            "Raw link https://example9.com/raw-\(tag) for later.\n\n\(paragraph)"
        let result = OpenClawChatMessage(
            role: "toolResult", content: [], timestamp: timestamp, transcriptRunID: runID,
            toolCallId: "call-\(tag)", toolName: "web_search", details: self.details(rows))
        let assistant = OpenClawChatMessage(
            role: "assistant",
            content: [
                OpenClawChatMessageContent(type: "toolCall", id: "call-\(tag)", name: "web_search"),
                OpenClawChatMessageContent(type: "tool_result", text: "Recorded", id: "call-\(tag)"),
                OpenClawChatMessageContent(type: "text", text: text),
                OpenClawChatMessageContent(type: "toolCall", id: "next-\(tag)", name: "read"),
                OpenClawChatMessageContent(type: "tool_result", text: "Recorded next", id: "next-\(tag)"),
            ],
            timestamp: timestamp + 1000,
            transcriptMessageID: "perf-answer-\(tag)",
            transcriptRunID: runID,
            phase: "final_answer")
        return (withSources ? [result] : []) + [assistant]
    }

    static func history(withSources: Bool) -> [OpenClawChatMessage] {
        (0..<self.runs).flatMap { index -> [OpenClawChatMessage] in
            let start = self.epochMs + Double(index) * 60000
            let question = OpenClawChatMessage(
                role: "user",
                content: [OpenClawChatMessageContent(
                    type: "text", text: "Question \(index): what changed in https://example.org/q-\(index)?")],
                timestamp: start,
                transcriptMessageID: "perf-question-\(index)")
            return [question] + self.answer(index, tag: "\(index)", withSources: withSources, timestamp: start + 1000)
        }
    }
}
'''

UI_TESTS = r'''

    // Scratch proof tests (never part of a PR): load a cited split transcript, scroll, append.
    func testScratchCitationProofCards() throws {
        try self.runScratchCitationProof(variant: "cards")
    }

    func testScratchCitationProofNoCards() throws {
        try self.runScratchCitationProof(variant: "nocards")
    }

    private func scratchMark(_ variant: String, _ phase: String, _ edge: String) {
        print("CHATPERF_MARK \(variant) \(phase) \(edge) \(Date().timeIntervalSince1970)")
    }

    private func runScratchCitationProof(variant: String) throws {
        self.scratchMark(variant, "load", "begin")
        self.launchApp(
            for: Self.chatScreenshotTarget,
            additionalArguments: ["--openclaw-perf-citations-fixture", variant])
        let app = try XCTUnwrap(self.app)
        let latest = app.descendants(matching: .any)
            .matching(NSPredicate(format: "label CONTAINS %@", "raw-59")).firstMatch
        XCTAssertTrue(latest.waitForExistence(timeout: 30), "latest cited answer missing")
        let transcript = try self.chatTranscript(in: app)
        Thread.sleep(forTimeInterval: 2)
        self.scratchMark(variant, "load", "end")
        self.attachScreenshot(named: "\(variant)-latest")

        let options = XCTMeasureOptions()
        options.iterationCount = 1
        self.scratchMark(variant, "scroll", "begin")
        measure(
            metrics: [XCTOSSignpostMetric.scrollDecelerationMetric, XCTOSSignpostMetric.scrollDraggingMetric],
            options: options)
        {
            print("CHATPERF_SCROLL_ITERATION \(Date().timeIntervalSince1970)")
            for _ in 0..<6 { transcript.swipeDown(velocity: .fast) }
            for _ in 0..<6 { transcript.swipeUp(velocity: .fast) }
            Thread.sleep(forTimeInterval: 1.5)
        }
        self.scratchMark(variant, "scroll", "end")
        self.attachScreenshot(named: "\(variant)-after-scroll")

        let input = self.chatMessageInput(in: app)
        XCTAssertTrue(input.waitForExistence(timeout: 8))
        self.scratchMark(variant, "append", "begin")
        for index in 0..<4 {
            input.tap()
            input.typeText("Append \(index)")
            let send = app.buttons["chat-send-message"]
            XCTAssertTrue(send.waitForExistence(timeout: 5) && send.isEnabled, "send button at append \(index)")
            send.tap()
            let answer = app.descendants(matching: .any)
                .matching(NSPredicate(format: "label CONTAINS %@", "raw-append-\(index)")).firstMatch
            XCTAssertTrue(answer.waitForExistence(timeout: 20), "appended answer \(index) missing")
        }
        Thread.sleep(forTimeInterval: 1.5)
        self.scratchMark(variant, "append", "end")
        self.attachScreenshot(named: "\(variant)-after-append")
        print("CHATPERF_DONE \(variant)")
        Thread.sleep(forTimeInterval: 1)
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
        "        if let perfVariant = ChatPerfFixture.variant {\n"
        "            return ChatPerfFixture.history(withSources: perfVariant == \"cards\")\n"
        "        }\n")
    replace_once(
        transport,
        "    private var reactionOverrides: [String: [OpenClawChatReactionSummary]] = [:]\n",
        "    private var reactionOverrides: [String: [OpenClawChatReactionSummary]] = [:]\n"
        "    private var perfAppended = 0\n")
    replace_once(
        transport,
        "        self.messages.append(userMessage)\n        self.publishReactions(for: userMessage, sessionKey: sessionKey)\n",
        "        self.messages.append(userMessage)\n        self.publishReactions(for: userMessage, sessionKey: sessionKey)\n"
        "        if let perfVariant = ChatPerfFixture.variant {\n"
        "            self.messages += ChatPerfFixture.answer(\n"
        "                ChatPerfFixture.runs + self.perfAppended, tag: \"append-\\(self.perfAppended)\",\n"
        "                withSources: perfVariant == \"cards\", timestamp: now + 1)\n"
        "            self.perfAppended += 1\n"
        "            return OpenClawChatSendResponse(runId: runId, status: \"ok\")\n"
        "        }\n")
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
