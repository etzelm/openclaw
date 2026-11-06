#!/usr/bin/env python3
"""Pair os_signpost begin/end events from `log stream --signpost --style ndjson` into intervals.

Usage: signpost_stream.py <side> <stream.ndjson>
Only events of subsystem ai.openclaw.chatperfproof are read. Prints the same JSON shape as signposts.py.
"""
import json
import sys

SUBSYSTEM = "ai.openclaw.chatperfproof"


def main():
    side, path = sys.argv[1], sys.argv[2]
    open_ = {}
    intervals = []
    events = 0
    with open(path, errors="replace") as handle:
        for line in handle:
            line = line.strip().rstrip(",")
            if not line.startswith("{"):
                continue
            try:
                event = json.loads(line)
            except ValueError:
                continue
            if event.get("subsystem") != SUBSYSTEM:
                continue
            events += 1
            kind = (event.get("signpostType") or "").lower()
            key = (event.get("signpostID"), event.get("signpostName"))
            stamp = event.get("machTimestamp")
            if kind.startswith("begin"):
                open_[key] = event
            elif kind.startswith("end") and key in open_:
                begin = open_.pop(key)
                ns = None
                if stamp is not None and begin.get("machTimestamp") is not None:
                    ns = int(stamp) - int(begin["machTimestamp"])  # mach ticks are ns on Apple silicon
                intervals.append({
                    "name": event.get("signpostName", ""),
                    "message": begin.get("eventMessage", ""),
                    "durationNs": ns,
                    "duration": "",
                    "begin": begin.get("timestamp", ""),
                })
    json.dump({"side": side, "subsystem": SUBSYSTEM, "intervals": intervals, "events": events}, sys.stdout, indent=2)
    print()
    if not intervals:
        sys.exit("no proof signposts in the stream")


if __name__ == "__main__":
    main()
