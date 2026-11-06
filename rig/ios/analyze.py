#!/usr/bin/env python3
"""Summarize the iOS simulator proof samples (lane p1).

Usage: analyze.py <out dir>
Per sample (side-round) and variant: phase windows come from the UI test's CHATPERF_MARK lines,
counts / main-thread time / frames from the app's chatperf-<pid>.txt event file.
Frames: consecutive CADisplayLink timestamps; an interval longer than 1.5x the nominal frame
interval is a hitch, and its excess over nominal counts as hitch time (ms per s of the phase).
"""
import hashlib
import json
import re
import statistics
import sys
from pathlib import Path

PHASES = ["load", "scroll", "append"]
LABELS = [
    ("messageRow.splitRow", "split rows evaluated by `ChatView.messageRow`"),
    ("rowSourcePreviews@messageRow", "`ChatSourcePreviewState.previews(for:)` under messageRow"),
    ("citationParse@messageRow", "`ChatSourcePreviewProjector.citations(in:)` under messageRow"),
    ("previewURLDocumentParse@messageRow", "`Document(parsing:)` under messageRow"),
]
CASE = re.compile(r"Test Case '-\[\S+ (testScratchCitationProof\w+)\]' (started|passed|failed)")
METRIC = re.compile(r"measured \[(.+?)\] average: ([0-9.]+)")


def parse_marks(path):
    marks, metrics, outcome, current = {}, {}, {}, None
    for line in path.read_text(errors="replace").splitlines():
        if m := CASE.search(line):
            current = "cards" if m.group(1).endswith("Cards") and not m.group(1).endswith("NoCards") else "nocards"
            if m.group(2) != "started":
                outcome[current] = m.group(2)
            continue
        if line.startswith("CHATPERF_MARK"):
            _, variant, phase, edge, ts = line.split()[:5]
            marks.setdefault(variant, {}).setdefault(phase, {})[edge] = float(ts)
        elif line.startswith("CHATPERF_SCROLL_ITERATION") and current:
            metrics.setdefault(current, {}).setdefault("scroll block runs", 0)
            metrics[current]["scroll block runs"] += 1
        elif (m := METRIC.search(line)) and current:
            metrics.setdefault(current, {})[m.group(1)] = float(m.group(2))
    return marks, metrics, outcome


def parse_events(path):
    header, events, durations, frames, rows, changes = "", [], [], [], {}, 0
    for line in path.read_text(errors="replace").splitlines():
        kind, _, rest = line.partition(" ")
        if kind == "h":
            header = rest
        elif kind == "e":
            ts, label = rest.split(" ", 1)
            events.append((float(ts), label))
        elif kind == "d":
            ts, which, ns = rest.split(" ")
            durations.append((float(ts), which, int(ns)))
        elif kind == "f":
            wall, stamp, _target = rest.split(" ")
            frames.append((float(wall), float(stamp)))
        elif kind == "r":
            ts, payload = rest.split(" ", 1)
            key, _, value = payload.partition("\t")
            if key in rows:
                changes += 1
            rows[key] = value
    variant = "cards" if "--openclaw-perf-citations-fixture cards" in header else "nocards"
    return variant, events, durations, frames, rows, changes


def frame_stats(frames, start, end):
    stamps = sorted(stamp for wall, stamp in frames if start <= wall <= end)
    intervals = [b - a for a, b in zip(stamps, stamps[1:]) if b > a]
    if not intervals:
        return {"frames": 0}
    nominal = statistics.median(intervals)
    hitches = [i for i in intervals if i > 1.5 * nominal]
    seconds = max(end - start, 1e-9)
    return {
        "frames": len(stamps),
        "nominalMs": round(nominal * 1000, 2),
        "hitches": len(hitches),
        "hitchTimeMs": round(sum(i - nominal for i in hitches) * 1000, 1),
        "hitchRatioMsPerS": round(sum(i - nominal for i in hitches) * 1000 / seconds, 2),
        "longestFrameMs": round(max(intervals) * 1000, 1),
        "seconds": round(seconds, 2),
    }


def sample(dir_):
    marks, metrics, outcome = parse_marks(dir_ / "marks.txt") if (dir_ / "marks.txt").exists() else ({}, {}, {})
    result = {}
    for path in sorted(dir_.glob("chatperf-*.txt")):
        variant, events, durations, frames, rows, changes = parse_events(path)
        windows = marks.get(variant, {})
        first = min([t for t, _ in events] + [w for w, _ in frames] or [0])
        phases = {}
        for phase in PHASES:
            edge = windows.get(phase, {})
            start = first if phase == "load" else edge.get("begin")
            end = edge.get("end")
            if start is None or end is None:
                continue
            counts = {label: sum(1 for t, l in events if l == label and start <= t <= end) for label, _ in LABELS}
            ns = sum(n for t, w, n in durations if w == "split" and start <= t <= end)
            phases[phase] = {
                "counts": counts,
                "sourcePreviewsSplitMs": round(ns / 1e6, 2),
                "frames": frame_stats(frames, start, end),
            }
        text = "\n\n".join(f"{k}\n{rows[k]}" for k in sorted(rows))
        result[variant] = {
            "phases": phases,
            "rowsSHA256": hashlib.sha256(text.encode()).hexdigest(),
            "rows": rows,
            "rowKeys": len(rows),
            "splitRowsWithCards": sum(1 for k, v in rows.items() if not k.endswith("#whole") and v),
            "appendedRunsRendered": len({k.split("#")[0] for k in rows if k.startswith("perf-run-append-")}),
            "rowCardChanges": changes,
            "xctestMetrics": metrics.get(variant, {}),
            "outcome": outcome.get(variant, "unknown"),
        }
    return result


def med(values, fmt="{:g}"):
    return fmt.format(statistics.median(values)) if values else "n/a"


def span(values):
    return f"{min(values):g}..{max(values):g}" if values else "n/a"


def main():
    out = Path(sys.argv[1])
    samples = {}
    for dir_ in sorted((out / "samples").iterdir()):
        if dir_.is_dir() and "-" in dir_.name:
            side, round_ = dir_.name.split("-", 1)
            samples.setdefault(side, {})[round_] = sample(dir_)
    env = (out / "environment.txt").read_text().strip() if (out / "environment.txt").exists() else "n/a"
    lines = ["### p1 iOS simulator: shipped app, Debug build", "", "```", env, "```", ""]
    summary_check = {}
    for status in sorted(out.glob("status-*.txt")):
        lines.append(f"- {status.name}: {status.read_text().strip()}")
    for variant in ("cards", "nocards"):
        per = {side: [s[variant] for _, s in sorted(samples.get(side, {}).items()) if variant in s]
               for side in ("base", "head")}
        lines += ["", f"#### Transcript `{variant}`", ""]
        for side in ("base", "head"):
            rows = per[side]
            lines.append(
                f"- {side}: {len(rows)} rounds, outcomes {[r['outcome'] for r in rows]}, appended answers rendered "
                f"{[r['appendedRunsRendered'] for r in rows]}, row keys "
                f"{sorted({r['rowKeys'] for r in rows})}, split rows with cards {sorted({r['splitRowsWithCards'] for r in rows})}, "
                f"row hashes {sorted({r['rowsSHA256'][:16] for r in rows})}, card changes {[r['rowCardChanges'] for r in rows]}")
        # Which rows get rendered depends on how far a run scrolled, so compare row by row: every row key
        # rendered on both sides (any round) must carry the same cards, and each side must agree with itself.
        seen = {side: {} for side in ("base", "head")}
        conflicts = 0
        for side in ("base", "head"):
            for r in per[side]:
                for key, value in r["rows"].items():
                    if seen[side].setdefault(key, value) != value:
                        conflicts += 1
        common = sorted(set(seen["base"]) & set(seen["head"]))
        mismatched = [k for k in common if seen["base"][k] != seen["head"][k]]
        carded = sum(1 for k in common if seen["base"][k])
        verdict = "IDENTICAL" if common and not mismatched and not conflicts else "DIFFERENT"
        lines.append(f"- rendered cards per row: {len(common)} row keys rendered on both sides ({carded} with cards), "
                     f"{len(mismatched)} differ, {conflicts} within-side conflicts -> {verdict}")
        summary_check[variant] = {"common": len(common), "carded": carded, "mismatched": mismatched, "conflicts": conflicts}
        lines += ["", "| Phase | Measure | Base median | Head median | Base range | Head range |", "|---|---|---:|---:|---|---|"]
        for phase in PHASES:
            def vals(side, getter):
                out_ = []
                for r in per[side]:
                    p = r["phases"].get(phase)
                    if p is not None:
                        v = getter(p)
                        if v is not None:
                            out_.append(v)
                return out_
            for label, text in LABELS:
                b, h = vals("base", lambda p: p["counts"][label]), vals("head", lambda p: p["counts"][label])
                lines.append(f"| {phase} | {text} | {med(b)} | {med(h)} | {span(b)} | {span(h)} |")
            b, h = vals("base", lambda p: p["sourcePreviewsSplitMs"]), vals("head", lambda p: p["sourcePreviewsSplitMs"])
            lines.append(f"| {phase} | main-thread ms in `sourcePreviews:` for split rows | {med(b, '{:.1f}')} | {med(h, '{:.1f}')} | {span(b)} | {span(h)} |")
            for key, text in (("hitches", "display-link hitches (>1.5 frames)"),
                              ("hitchRatioMsPerS", "hitch time ratio, ms per s"),
                              ("longestFrameMs", "longest frame interval, ms"),
                              ("frames", "frames delivered")):
                b = vals("base", lambda p: p["frames"].get(key))
                h = vals("head", lambda p: p["frames"].get(key))
                lines.append(f"| {phase} | {text} | {med(b)} | {med(h)} | {span(b)} | {span(h)} |")
        names = sorted({k for side in per.values() for r in side for k in r["xctestMetrics"]})
        if names:
            lines += ["", "XCTest metrics during the scroll block (`measure`, XCTOSSignpostMetric):", "",
                      "| Metric | Base median | Head median | Base range | Head range |", "|---|---:|---:|---|---|"]
            for name in names:
                b = [r["xctestMetrics"][name] for r in per["base"] if name in r["xctestMetrics"]]
                h = [r["xctestMetrics"][name] for r in per["head"] if name in r["xctestMetrics"]]
                lines.append(f"| {name} | {med(b)} | {med(h)} | {span(b)} | {span(h)} |")
    shots = []
    for png in sorted((out / "samples").glob("*/attachments/*.png")):
        shots.append(f"{png.parent.parent.name}/{png.name} {hashlib.sha256(png.read_bytes()).hexdigest()[:16]}")
    (out / "screenshots.txt").write_text("\n".join(shots) + "\n")
    (out / "counts.json").write_text(json.dumps({"outputCheck": summary_check, "samples": samples}, indent=2, sort_keys=True))
    print("\n".join(lines))


if __name__ == "__main__":
    main()
