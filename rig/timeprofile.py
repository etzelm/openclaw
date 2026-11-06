#!/usr/bin/env python3
"""Reduce an xctrace time-profile export to main-thread sample counts for the p1 path.

Usage: timeprofile.py <side> <time-profile.xml>
Prints JSON. Only aggregate counts of samples whose stack contains the named
OpenClaw functions leave the job; no addresses, paths or other process data.
"""
import json
import re
import sys
import xml.etree.ElementTree as ET

STACKS = {
    "OpenClawChatView.messageRow(for:...)": re.compile(r"OpenClawChatView\.messageRow\(for:"),
    "ChatSourcePreviewState.previews(for:)": re.compile(r"ChatSourcePreviewState\.previews\(for:"),
    "ChatSourcePreviewProjector.citations(in:)": re.compile(r"ChatSourcePreviewProjector\.citations\(in:"),
    "Document(parsing:)": re.compile(r"Document\.init\(parsing:|Document\(parsing:"),
}


def main():
    side, path = sys.argv[1], sys.argv[2]
    by_id = {}
    samples = 0
    stacks = {name: 0 for name in STACKS}
    combo = {
        "previews(for:) and Document(parsing:)": 0,
        "messageRow and previews(for:)": 0,
    }
    leaf = {}

    def resolve(elem):
        ref = elem.get("ref")
        return by_id.get(ref, elem) if ref else elem

    for _, elem in ET.iterparse(path, events=("end",)):
        if elem.get("id"):
            by_id[elem.get("id")] = elem
        if elem.tag != "row":
            continue
        thread = next((resolve(c) for c in elem if c.tag == "thread"), None)
        if thread is None or "Main Thread" not in (thread.get("fmt") or ""):
            continue
        backtrace = next((resolve(c) for c in elem if c.tag in ("backtrace", "tagged-backtrace")), None)
        if backtrace is None:
            continue
        if backtrace.tag == "tagged-backtrace":
            inner = backtrace.find("backtrace")
            backtrace = resolve(inner) if inner is not None else backtrace
        names = [resolve(f).get("name") or "" for f in backtrace.iter("frame")]
        samples += 1
        hit = {name: any(rx.search(n) for n in names) for name, rx in STACKS.items()}
        for name, value in hit.items():
            stacks[name] += value
        combo["previews(for:) and Document(parsing:)"] += (
            hit["ChatSourcePreviewState.previews(for:)"] and hit["Document(parsing:)"])
        combo["messageRow and previews(for:)"] += (
            hit["OpenClawChatView.messageRow(for:...)"] and hit["ChatSourcePreviewState.previews(for:)"])
        if names and ("OpenClaw" in names[0] or "Chat" in names[0] or "Markdown" in names[0]):
            short = re.sub(r"\s+", " ", names[0])[:120]
            leaf[short] = leaf.get(short, 0) + 1
    stacks.update(combo)
    top = sorted(leaf.items(), key=lambda kv: -kv[1])[:15]
    print(json.dumps({"side": side, "samples": samples, "stacks": stacks, "topChatLeafFunctions": top}, indent=2))


if __name__ == "__main__":
    main()
