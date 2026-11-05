#!/usr/bin/env python3
"""Summarize one lane's base vs head workload samples as Markdown.

Usage: summarize.py <lane> <out dir> <title>
"""
import json
import statistics
import sys
from pathlib import Path


def pct(values, q):
    ordered = sorted(values)
    if not ordered:
        return float("nan")
    index = min(len(ordered) - 1, max(0, round(q * (len(ordered) - 1))))
    return ordered[index]


def load(out):
    samples = {"base": [], "head": []}
    for path in sorted((out / "samples").glob("*.json")):
        data = json.loads(path.read_text())
        if data.get("sample") == "trace":
            continue
        samples.setdefault(data["label"], []).append(data)
    return samples


def phase_table(samples):
    names = []
    for data in samples["base"] + samples["head"]:
        for phase in data["phases"]:
            if phase["name"] not in names:
                names.append(phase["name"])
    lines = []
    for name in names:
        per_side = {}
        for side in ("base", "head"):
            phases = [p for d in samples[side] for p in d["phases"] if p["name"] == name]
            per_side[side] = phases
        steps = (per_side["base"] or per_side["head"])[0]["steps"]
        lines.append(f"\n#### Phase `{name}` ({steps} steps)\n")
        lines.append("| Measure | Base (median) | Head (median) | Base range | Head range |")
        lines.append("|---|---:|---:|---|---|")
        labels = sorted({k for side in per_side.values() for p in side for k in p["counts"]})
        for label in labels:
            cells = []
            ranges = []
            for side in ("base", "head"):
                values = [p["counts"].get(label, 0) for p in per_side[side]]
                cells.append(f"{statistics.median(values):g}" if values else "n/a")
                ranges.append(f"{min(values)}..{max(values)}" if values else "n/a")
            lines.append(f"| `{label}` calls | {cells[0]} | {cells[1]} | {ranges[0]} | {ranges[1]} |")
        cells = []
        ranges = []
        for side in ("base", "head"):
            values = [p["ms"] for p in per_side[side]]
            cells.append(f"{statistics.median(values):.1f} ms" if values else "n/a")
            ranges.append(f"p95 {pct(values, 0.95):.1f}, min {min(values):.1f}" if values else "n/a")
        lines.append(f"| wall time | {cells[0]} | {cells[1]} | {ranges[0]} | {ranges[1]} |")
    return lines


def signpost_lines(out):
    lines = []
    for side in ("base", "head"):
        path = out / f"{side}-signposts.json"
        if not path.exists():
            lines.append(f"- {side}: no signpost export")
            continue
        data = json.loads(path.read_text())
        parts = [f"{i['message'] or i['name']} {i['duration']}" for i in data["intervals"]]
        lines.append(f"- {side}: {len(data['intervals'])} intervals ({'; '.join(parts) or 'none'})")
    return lines


def main():
    lane, out, title = sys.argv[1], Path(sys.argv[2]), sys.argv[3]
    samples = load(out)
    env = (out / "environment.txt").read_text().strip() if (out / "environment.txt").exists() else "n/a"
    lines = [f"### {lane}: {title}", "", "```", env, "```", ""]
    for side in ("base", "head"):
        focused = out / f"{side}-focused.txt"
        text = focused.read_text().strip() if focused.exists() else "not run"
        lines.append(f"- {side} focused suites: {text or 'no result line'}")
    meta = []
    for side in ("base", "head"):
        if samples[side]:
            first = samples[side][0]
            meta.append(
                f"{side}: {len(samples[side])} samples, {first['historyRows']} history rows, "
                f"{first['projectedCards']} projected cards, regex counting {first['regexCounting']}")
        else:
            meta.append(f"{side}: no samples")
    lines += [f"- {m}" for m in meta]
    status = out / "status.txt"
    if status.exists() and status.read_text().strip():
        lines.append(f"- failures: {status.read_text().strip()}")
    if samples["base"] and samples["head"]:
        lines += phase_table(samples)
    lines += ["", "#### os_signpost intervals (xctrace, one extra run per side)", ""] + signpost_lines(out)
    print("\n".join(lines))


if __name__ == "__main__":
    main()
