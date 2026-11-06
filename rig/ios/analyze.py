#!/usr/bin/env python3
"""Summarize the iOS simulator proof samples for lane p2 (shipped app, demo transport event script).

Usage: analyze.py <out dir>
Per sample (samples/<side>-<round>/): step windows come from the app's own chatperf-marks.txt
(written by the demo store as it publishes each event), projector work, card digests, rendered rows
and display-link frames from the probe's chatperf-<pid>.txt. A step's window runs from its mark to
the next mark. Frames: an interval longer than 1.5x the nominal interval is a hitch.
"""
import hashlib
import json
import re
import statistics
import sys
from pathlib import Path

SIDES = ("base", "head")
PHASES = [
    ("load", "transcript load (80 cited replies)"),
    ("append", "one persisted message (`.sessionMessage`)"),
    ("refresh", "history refresh (`sessions.changed`), same ids + 1 row"),
    ("context", "source context refresh (`.chatMetadataChanged`)"),
]
APPEND_KINDS = ["user question", "web_search result", "cited reply"]


def pct(values, q):
    if not values:
        return None
    ordered = sorted(values)
    return ordered[max(0, min(len(ordered) - 1, int(round(q * (len(ordered) - 1)))))]


def span(values):
    if not values:
        return "n/a"
    med, lo, hi = statistics.median(values), min(values), max(values)
    return f"{med:g}" if lo == hi else f"{med:g} ({lo:g} to {hi:g})"


def parse_marks(path):
    marks = []
    for line in path.read_text(errors="replace").splitlines():
        parts = line.split(" ", 2)
        if len(parts) == 3 and parts[0] == "m":
            marks.append((float(parts[1]), parts[2]))
    return marks


def parse_events(path):
    out = {"u": [], "p": [], "c": [], "n": [], "r": [], "f": []}
    for line in path.read_text(errors="replace").splitlines():
        kind, _, rest = line.partition(" ")
        fields = rest.split(" ")
        try:
            if kind in ("u", "p"):
                out[kind].append((float(fields[0]), int(fields[1]), int(fields[2]), int(fields[3]), int(fields[4])))
            elif kind == "c":
                out["c"].append((float(fields[0]), fields[1], fields[2]))
            elif kind == "n":
                out["n"].append((float(fields[0]), int(fields[1]), int(fields[2]), fields[3]))
            elif kind == "r":
                out["r"].append((float(fields[0]), fields[1], fields[2], int(fields[3])))
            elif kind == "f":
                out["f"].append((float(fields[0]), float(fields[1])))
        except (IndexError, ValueError):
            continue
    return out


def frame_stats(frames, start, end):
    stamps = sorted(stamp for wall, stamp in frames if start <= wall <= end)
    intervals = [b - a for a, b in zip(stamps, stamps[1:]) if b > a]
    if not intervals:
        return {"frames": 0, "hitches": 0, "hitchTimeMs": 0.0, "seconds": round(end - start, 2), "longestFrameMs": 0.0}
    nominal = statistics.median(intervals)
    hitches = [i for i in intervals if i > 1.5 * nominal]
    return {
        "frames": len(stamps),
        "nominalMs": round(nominal * 1000, 2),
        "hitches": len(hitches),
        "hitchTimeMs": round(sum(i - nominal for i in hitches) * 1000, 1),
        "longestFrameMs": round(max(intervals) * 1000, 1),
        "seconds": round(end - start, 2),
    }


def sample(dir_):
    marks_path = dir_ / "chatperf-marks.txt"
    logs = [p for p in dir_.glob("chatperf-*.txt") if p.name != "chatperf-marks.txt"]
    if not marks_path.exists() or not logs:
        return None
    marks = parse_marks(marks_path)
    ev = parse_events(max(logs, key=lambda p: p.stat().st_size))
    steps = []  # (phase, index, start, end)
    step_marks = [(t, text.split()) for t, text in marks if text.startswith("step ")]
    done = next((t for t, text in marks if text == "done"), None)
    first = min([t for t, *_ in ev["u"]] or [0])
    if step_marks:
        steps.append(("load", 0, first - 1, step_marks[0][0]))
    for i, (t, parts) in enumerate(step_marks):
        end = step_marks[i + 1][0] if i + 1 < len(step_marks) else (done or t + 2)
        steps.append((parts[1], int(parts[2]), t, end))
    records = []
    for phase, index, start, end in steps:
        calls = [u for u in ev["u"] if start <= u[0] < end]
        projects = [p for p in ev["p"] if start <= p[0] < end]
        last = [n for n in ev["n"] if n[0] < end]
        records.append({
            "phase": phase, "index": index,
            "updates": len(calls),
            "cardBuilds": sum(u[2] for u in calls),
            "titleRenders": sum(u[3] for u in calls),
            "excerptRenders": sum(u[4] for u in calls),
            "updateMs": [u[1] / 1e6 for u in calls],
            "projectMs": [p[1] / 1e6 for p in projects],
            "citedReplies": last[-1][1] if last else 0,
            "allDigest": last[-1][3] if last else "",
            "frames": frame_stats(ev["f"], start, end),
        })
    replies = {}
    for _, key, sha in ev["c"]:
        replies[key] = sha
    rows = {}
    for _, key, sha, count in ev["r"]:
        rows[key] = (sha, count)
    final = ev["n"][-1] if ev["n"] else (0, 0, 0, "")
    return {
        "records": records,
        "done": done is not None,
        "stepMarks": {p: sum(1 for _, parts in step_marks if parts[1] == p) for p in ("append", "refresh", "context")},
        "finalCitedReplies": final[1],
        "finalCards": final[2],
        "finalDigest": final[3],
        "replyDigests": replies,
        "rowDigests": {k: v[0] for k, v in rows.items()},
        "rowsWithCards": sum(1 for v in rows.values() if v[1] > 0),
        "rowsSHA256": hashlib.sha256("\n".join(f"{k}={rows[k][0]}" for k in sorted(rows)).encode()).hexdigest(),
    }


def phase_digests(s):
    """Card digest at the end of each phase (last update before the next phase starts)."""
    out = {}
    for r in s["records"]:
        out[r["phase"]] = r["allDigest"]
    return out


def main():
    out = Path(sys.argv[1])
    samples = {side: {} for side in SIDES}
    for dir_ in sorted((out / "samples").glob("*-*")):
        side, _, round_ = dir_.name.partition("-")
        if side in samples and (s := sample(dir_)):
            samples[side][round_] = s
    env = (out / "environment.txt").read_text().strip() if (out / "environment.txt").exists() else "n/a"
    lines = ["### p2 shipped iOS app on an iOS simulator", "", "```", env, "```", ""]
    status = sorted(out.glob("status-*.txt"))
    for path in status:
        lines.append(f"- {path.name}: {path.read_text().strip()}")
    for side in SIDES:
        ok = [r for r, s in samples[side].items() if s["done"]]
        marks = {r: s["stepMarks"] for r, s in samples[side].items()}
        lines.append(f"- {side}: {len(samples[side])} samples with logs, script finished in {len(ok)} "
                     f"(rounds {', '.join(sorted(ok))}); step marks {marks}")
    result = {"samples": {side: sorted(samples[side]) for side in SIDES}}
    if not (samples["base"] and samples["head"]):
        lines.append("- not enough samples for a comparison")
        print("\n".join(lines))
        (out / "counts.json").write_text(json.dumps(result, indent=2))
        return

    def recs(side, phase, select=None):
        return [r for s in samples[side].values() if s["done"] for r in s["records"]
                if r["phase"] == phase and (select is None or select(r["index"]))]

    rows = [("load", "transcript load", None)] + \
        [("append", f"append: {k}", (lambda n: lambda i: i % 3 == n)(n)) for n, k in enumerate(APPEND_KINDS)] + \
        [("append", "append: any message", None),
         ("refresh", "history refresh: first after the appends", lambda i: i == 0),
         ("refresh", "history refresh: later ones", lambda i: i > 0),
         ("context", "source context refresh", None)]
    lines += ["", "#### Projector work per step (median, range over all steps of all finished samples)", "",
              "| Step | N cited replies | `update` calls, base / head | Card builds, base | Card builds, head | "
              "Title renders, base / head | Excerpt renders, base / head |",
              "|---|---:|---:|---:|---:|---:|---:|"]
    counts = {}
    for phase, title, select in rows:
        b, h = recs("base", phase, select), recs("head", phase, select)
        n = sorted({r["citedReplies"] for r in b + h})
        n_text = (str(n[0]) if len(n) == 1 else f"{n[0]} to {n[-1]}") if n else "n/a"
        cell = lambda rs, k: span([r[k] for r in rs])
        lines.append(f"| {title} | {n_text} | {cell(b, 'updates')} / {cell(h, 'updates')} | {cell(b, 'cardBuilds')} | "
                     f"{cell(h, 'cardBuilds')} | {cell(b, 'titleRenders')} / {cell(h, 'titleRenders')} | "
                     f"{cell(b, 'excerptRenders')} / {cell(h, 'excerptRenders')} |")
        counts[title] = {side: {k: [r[k] for r in rs] for k in ("updates", "cardBuilds", "titleRenders", "excerptRenders")}
                         for side, rs in (("base", b), ("head", h))}
    result["counts"] = counts

    lines += ["", "#### `ChatSourcePreviewState.update` main-thread time per call (os_signpost interval, in-process timer)", "",
              "| Phase | Calls base / head | Base median | Base p95 | Head median | Head p95 |", "|---|---:|---:|---:|---:|---:|"]
    times = {}
    for phase, title in PHASES:
        b = [ms for r in recs("base", phase) for ms in r["updateMs"]]
        h = [ms for r in recs("head", phase) for ms in r["updateMs"]]
        f = lambda v: f"{v:.2f} ms" if v is not None else "n/a"
        lines.append(f"| {title} | {len(b)} / {len(h)} | {f(statistics.median(b) if b else None)} | {f(pct(b, .95))} | "
                     f"{f(statistics.median(h) if h else None)} | {f(pct(h, .95))} |")
        times[phase] = {"base": b, "head": h}
    cold = {side: [max(r["updateMs"]) for r in recs(side, "load") if r["updateMs"]] for side in SIDES}
    lines.append("")
    for side in SIDES:
        lines.append(f"- {side}: longest `update` during load per sample (the cold projection), ms: "
                     + ", ".join(f"{v:.1f}" for v in cold[side])
                     + (f"; median {statistics.median(cold[side]):.1f}" if cold[side] else ""))
    result["times"] = times
    result["cold"] = cold

    lines += ["", "#### Frames during each phase (CADisplayLink on the main run loop; hitch = interval > 1.5x nominal)", "",
              "| Phase | Hitches base / head | Hitch time base / head | Longest frame, median per step, base / head |",
              "|---|---:|---:|---:|"]
    frames = {}
    for phase, title in PHASES:
        cells = {}
        for side in SIDES:
            rs = recs(side, phase)
            cells[side] = (sum(r["frames"]["hitches"] for r in rs), sum(r["frames"]["hitchTimeMs"] for r in rs),
                           statistics.median([r["frames"]["longestFrameMs"] for r in rs]) if rs else 0)
        frames[phase] = cells
        lines.append(f"| {title} | {cells['base'][0]} / {cells['head'][0]} | {cells['base'][1]:.0f} / {cells['head'][1]:.0f} ms | "
                     f"{cells['base'][2]:.1f} / {cells['head'][2]:.1f} ms |")
    result["frames"] = frames

    lines += ["", "#### Output: cards per cited reply (SHA-256)", ""]
    done = {side: [s for s in samples[side].values() if s["done"]] for side in SIDES}
    ok = True
    for phase, title in PHASES:
        values = {side: {phase_digests(s).get(phase) for s in done[side]} for side in SIDES}
        equal = len(values["base"]) == 1 and values["base"] == values["head"]
        ok = ok and equal
        lines.append(f"- end of {phase}: {'equal, ' + next(iter(values['base']))[:16] if equal else 'DIFFERS ' + str(values)}")
    ref = done["base"][0]["replyDigests"] if done["base"] else {}
    mismatch = sorted({k for side in SIDES for s in done[side] for k in set(s["replyDigests"]) | set(ref)
                       if s["replyDigests"].get(k) != ref.get(k)})
    rows_ref = done["base"][0]["rowsSHA256"] if done["base"] else ""
    rows_equal = all(s["rowsSHA256"] == rows_ref for side in SIDES for s in done[side])
    lines.append(f"- cited replies with cards at the end: {len(ref)}; replies whose cards differ between any base and head "
                 f"sample: {len(mismatch)}")
    lines.append(f"- cards handed to rendered `ChatView` rows: {'same' if rows_equal else 'differ'} on every sample "
                 f"(rows with cards per sample: {sorted({s['rowsWithCards'] for side in SIDES for s in done[side]})})")
    result["output"] = {"phaseDigestsEqual": ok, "replyMismatches": mismatch, "replies": len(ref), "rowsEqual": rows_equal}

    shots = {}
    for manifest in sorted((out / "samples").glob("*/attachments/manifest.json")):
        side = manifest.parts[-3].split("-")[0]
        for test in json.loads(manifest.read_text()):
            for item in test.get("attachments", []):
                path = manifest.parent / item["exportedFileName"]
                name = re.sub(r"_\d+_[0-9A-F-]+\.png$", "", item.get("suggestedHumanReadableName", path.name))
                if path.exists():
                    shots.setdefault(name, {}).setdefault(side, set()).add(hashlib.md5(path.read_bytes()).hexdigest())
    lines += ["", "#### Screenshots", ""]
    for name, by_side in sorted(shots.items()):
        lines.append(f"- {name}: distinct images base {len(by_side.get('base', []))}, head {len(by_side.get('head', []))}, "
                     f"shared {len(by_side.get('base', set()) & by_side.get('head', set()))}")
    for side in SIDES:
        p = out / f"signposts-{side}.json"
        if p.exists():
            d = json.loads(p.read_text())
            ms = [i["durationNs"] / 1e6 for i in d["intervals"] if i["name"] == "sourceStateUpdate" and i["durationNs"]]
            lines.append(f"- xctrace {side}: {len(ms)} `sourceStateUpdate` intervals"
                         + (f", median {statistics.median(ms):.2f} ms, p95 {pct(ms, .95):.2f} ms" if ms else ""))
    (out / "counts.json").write_text(json.dumps(result, indent=2, default=list))
    print("\n".join(lines))


if __name__ == "__main__":
    main()
