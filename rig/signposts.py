#!/usr/bin/env python3
"""Redact an xctrace os_signpost export to the proof workload's own intervals.

Usage: signposts.py <side> <os-signpost-interval.xml> [os-signpost.xml]
Prints JSON: only rows whose subsystem is ai.openclaw.chatperfproof are kept, so
nothing about other processes on the runner leaves the job.
"""
import json
import sys
import xml.etree.ElementTree as ET

SUBSYSTEM = "ai.openclaw.chatperfproof"


def rows(path):
    try:
        root = ET.parse(path).getroot()
    except (ET.ParseError, FileNotFoundError, OSError):
        return []
    values = {}
    out = []
    for node in root.iter("node"):
        schema = node.find("schema")
        if schema is None:
            continue
        columns = [col.findtext("mnemonic") for col in schema.findall("col")]
        for row in node.findall("row"):
            record = {}
            for column, cell in zip(columns, list(row)):
                ref = cell.get("ref")
                if ref is not None:
                    raw, fmt = values.get(ref, ("", ""))
                else:
                    raw = "".join(cell.itertext()).strip()
                    fmt = cell.get("fmt", raw)
                    if cell.get("id") is not None:
                        values[cell.get("id")] = (raw, fmt)
                    for child in cell.iter():
                        if child is not cell and child.get("id") is not None:
                            values[child.get("id")] = ("".join(child.itertext()).strip(), child.get("fmt", ""))
                record[column] = {"raw": raw, "fmt": fmt}
            if any(SUBSYSTEM in (v["raw"] + v["fmt"]) for v in record.values()):
                out.append(record)
    return out


def main():
    side = sys.argv[1]
    intervals = []
    for record in rows(sys.argv[2]):
        message = next((record[k]["fmt"] for k in ("message", "start-message", "formatted-message") if k in record), "")
        duration = record.get("duration", {}).get("raw", "")
        intervals.append({
            "name": record.get("name", {}).get("fmt", ""),
            "message": message,
            "durationNs": int(duration) if duration.isdigit() else None,
            "duration": record.get("duration", {}).get("fmt", ""),
        })
    events = len(rows(sys.argv[3])) if len(sys.argv) > 3 else 0
    json.dump({"side": side, "subsystem": SUBSYSTEM, "intervals": intervals, "events": events}, sys.stdout, indent=2)
    print()
    if not intervals and not events:
        sys.exit("no proof signposts found in the trace export")


if __name__ == "__main__":
    main()
