#!/usr/bin/env python3
"""Insert identical scratch call counters into OpenClawChatUI (base and head alike).

Usage: instrument.py <OpenClawChatUI source dir> <ChatPerfProbe.swift>
Each target function gets `let _ = ChatPerfProbe.hit("<label>")` as its first
statement. A single-expression body gets an explicit `return` so it still compiles.
Fails if a target is missing or ambiguous, so base and head always carry the same probes.
"""
import re
import shutil
import sys
from pathlib import Path

TARGETS = [
    ("ChatViewModel+SourcePreviews.swift", r"^\s*func previews\(for message", "rowSourcePreviews"),
    ("ChatViewModel+SourcePreviews.swift", r"^\s*func update\(_ messages", "sourceStateUpdate"),
    ("ChatSourcePreviews.swift", r"^\s*static func citations\(in message", "citationParse"),
    ("ChatSourcePreviews.swift", r"^\s*mutating func project\(", "project"),
    ("ChatSourcePreviews.swift", r"^\s*private static func previews\(", "cardBuild"),
    ("ChatSourcePreviews.swift", r"^\s*private static func title\(", "cardTitleRender"),
    ("ChatSourcePreviews.swift", r"^\s*private static func excerpt\(", "cardExcerptRender"),
    ("ChatSourcePreviews.swift", r"^\s*private static func prose\(", "externalFrameStrip"),
]

# Labels whose whole body is also wrapped in an os_signpost interval with a monotonic timer.
TIMED = {"sourceStateUpdate"}

STATEMENT = re.compile(r"^(return|guard|let|var|if|for|while|switch|defer|do|throw|_ =)\b")


def instrument(source_dir: Path) -> list[str]:
    report = []
    files: dict[str, list[str]] = {}
    for name, pattern, label in TARGETS:
        lines = files.setdefault(name, (source_dir / name).read_text().split("\n"))
        hits = [i for i, line in enumerate(lines) if re.search(pattern, line)]
        if len(hits) != 1:
            sys.exit(f"instrument: {name}: {pattern!r} matched {len(hits)} lines")
        start = hits[0]
        brace = next((i for i in range(start, min(start + 12, len(lines))) if lines[i].rstrip().endswith("{")), None)
        if brace is None:
            sys.exit(f"instrument: {name}: no body brace after line {start + 1}")
        body = lines[brace + 1]
        indent = re.match(r"^\s*", body).group(0) or "    "
        probe = f'{indent}let _ = ChatPerfProbe.hit("{label}")'
        if label in TIMED:
            probe += (f'\n{indent}let chatPerfInterval = ChatPerfProbe.begin("{label}")'
                      f'\n{indent}defer {{ ChatPerfProbe.end("{label}", chatPerfInterval) }}')
        single = lines[brace + 2].strip() == "}" and not STATEMENT.match(body.strip())
        if single:
            lines[brace + 1] = f"{indent}return {body.strip()}"
        lines.insert(brace + 1, probe)
        report.append(f"{label}: {name}:{start + 1}{' (single expression)' if single else ''}{' (timed)' if label in TIMED else ''}")
    for name, lines in files.items():
        (source_dir / name).write_text("\n".join(lines))
    return report


def main() -> None:
    source_dir = Path(sys.argv[1])
    shutil.copy(sys.argv[2], source_dir / "ChatPerfProbe.swift")
    for line in instrument(source_dir):
        print(line)


if __name__ == "__main__":
    main()
