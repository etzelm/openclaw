#!/usr/bin/env python3
"""Summarize the p2 workload samples: counts per phase, update times, output digests.

Usage: summarize.py <lane> <out dir> <title>
Writes markdown to stdout and <out dir>/counts.json.
"""
import json
import statistics
import sys
from pathlib import Path

SIDES = ("base", "head")
METRICS = [
    ("sourceStateUpdate", "`ChatSourcePreviewState.update` calls"),
    ("cardBuild", "per-reply card builds (`previews(links:entries:...)`)"),
    ("cardTitleRender", "title renders"),
    ("cardExcerptRender", "excerpt renders"),
    ("citationParse", "citation parses"),
]
PHASES = [
    ("load", "initial history load (once)"),
    ("append", "one persisted message appended (`.sessionMessage`)"),
    ("reloadSame", "history reload, identical rows"),
    ("reloadGrown", "history reload, same ids + 1 new row"),
    ("contextChange", "source context change (`.chatMetadataChanged`)"),
]
APPEND_KINDS = ["user question", "web_search result", "cited answer"]


def pct(values, q):
    if not values:
        return None
    ordered = sorted(values)
    index = max(0, min(len(ordered) - 1, int(round(q * (len(ordered) - 1)))))
    return ordered[index]


def load(out):
    samples = {side: [] for side in SIDES}
    for path in sorted((out / "samples").glob("*.json")):
        data = json.loads(path.read_text())
        if data.get("sample") == "trace" or path.name.startswith("cold-"):
            continue
        samples.setdefault(data["label"], []).append(data)
    return samples


def phase(data, name):
    return next((p for p in data["phases"] if p["name"] == name), None)


def steps(samples, name, select=None):
    """Records of phase `name`; `select(index)` picks steps (None = all)."""
    out = []
    for data in samples:
        p = phase(data, name)
        if not p:
            continue
        for index, record in enumerate(p["steps"]):
            if select is None or select(index):
                out.append(record)
    return out


def span(values):
    if not values:
        return "n/a"
    lo, hi, med = min(values), max(values), statistics.median(values)
    return f"{med:g}" if lo == hi else f"{med:g} ({lo:g} to {hi:g})"


def count_table(samples, rows):
    lines = [
        "| Phase (per step) | Metric | Base | Head |",
        "|---|---|---:|---:|",
    ]
    data = {}
    for key, title, kind in rows:
        cited = {side: [r["citedReplies"] for r in steps(samples[side], key, kind)] for side in SIDES}
        n = sorted(set(cited["base"] + cited["head"]))
        n_text = f"N = {n[0]}" if len(n) == 1 else (f"N = {n[0]} to {n[-1]}" if n else "N = n/a")
        data[title] = {}
        for metric, label in METRICS:
            cells = []
            for side in SIDES:
                values = [r["counts"].get(metric, 0) for r in steps(samples[side], key, kind)]
                data[title].setdefault(side, {})[metric] = {
                    "median": statistics.median(values) if values else None,
                    "min": min(values) if values else None,
                    "max": max(values) if values else None,
                    "steps": len(values),
                }
                cells.append(span(values))
            lines.append(f"| {title}, {n_text} | {label} | {cells[0]} | {cells[1]} |")
    return lines, data


def time_table(samples):
    lines = [
        "| Phase | Base update calls | Base median ms | Base p95 ms | Head update calls | Head median ms | Head p95 ms |",
        "|---|---:|---:|---:|---:|---:|---:|",
    ]
    data = {}
    for key, title in PHASES:
        cells = []
        data[key] = {}
        for side in SIDES:
            values = [ns / 1e6 for r in steps(samples[side], key) for ns in r["updateNs"]]
            med, p95 = (statistics.median(values), pct(values, 0.95)) if values else (None, None)
            data[key][side] = {"n": len(values), "medianMs": med, "p95Ms": p95}
            cells += [str(len(values)), f"{med:.3f}" if med is not None else "n/a",
                      f"{p95:.3f}" if p95 is not None else "n/a"]
        lines.append(f"| {title} | " + " | ".join(cells) + " |")
    return lines, data


def digest_lines(samples):
    lines = ["| Checkpoint | Distinct digests on base | Distinct digests on head | Equal |", "|---|---:|---:|---|"]
    checkpoints = sorted({k for side in SIDES for d in samples[side] for k in d.get("digests", {})})
    order = ["load", "append", "reloadSame", "reloadGrown", "contextGateway", "final"]
    checkpoints.sort(key=lambda k: order.index(k) if k in order else len(order))
    ok = True
    data = {}
    for checkpoint in checkpoints:
        values = {side: sorted({d["digests"].get(checkpoint) for d in samples[side]}) for side in SIDES}
        equal = len(values["base"]) == 1 and values["base"] == values["head"]
        ok = ok and equal
        data[checkpoint] = {**values, "equal": equal}
        lines.append(f"| `{checkpoint}` | {len(values['base'])} | {len(values['head'])} | "
                     f"{'yes, ' + values['base'][0][:16] if equal else 'NO'} |")
    replies = {side: [d.get("perReplyDigest", {}) for d in samples[side]] for side in SIDES}
    reference = replies["base"][0] if replies["base"] else {}
    mismatched = sorted({run for side in SIDES for per in replies[side] for run in set(per) | set(reference)
                         if per.get(run) != reference.get(run)})
    lines.append("")
    lines.append(f"- Cited replies with cards at the end: {len(reference)}. Replies whose card digest differs "
                 f"between any base and head sample: {len(mismatched)}{' (' + ', '.join(mismatched[:10]) + ')' if mismatched else ''}.")
    return lines, {"checkpoints": data, "perReplyMismatches": mismatched, "citedRepliesWithCards": len(reference),
                   "equal": ok and not mismatched}


def fmt_list(values):
    return ", ".join(f"{v:.1f}" for v in values)


def cold_lines(out):
    rows = {side: [] for side in SIDES}
    for path in sorted((out / "samples").glob("cold-*.json")):
        data = json.loads(path.read_text())
        rows.setdefault(data["label"], []).append(data)
    if not rows["base"] or not rows["head"]:
        return ["- no cold samples"], {}
    lines = [
        "| Cold sample set | Metric | Base n | Base median | Base p95 | Head n | Head median | Head p95 | Head vs base (median) |",
        "|---|---|---:|---:|---:|---:|---:|---:|---:|",
    ]
    result = {}
    lists = []
    for title, select in (("first view in a fresh process", lambda v: v["index"] == 0),
                          ("fresh view in a warm process (views 2 to 8)", lambda v: v["index"] > 0)):
        for metric, name in (("updateMs", "`update` call that built all cards"), ("projectMs", "`project` inside it")):
            cells, meds = [], {}
            for side in SIDES:
                values = [v[metric] for d in sorted(rows[side], key=lambda d: int(d["sample"]))
                          for v in d["views"] if select(v) and v[metric] >= 0]
                med = statistics.median(values) if values else None
                meds[side] = med
                result.setdefault(title, {}).setdefault(metric, {})[side] = {
                    "n": len(values), "median": med, "p95": pct(values, 0.95), "values": values}
                cells += [str(len(values)), f"{med:.1f} ms" if med is not None else "n/a",
                          f"{pct(values, 0.95):.1f} ms" if values else "n/a"]
                if metric == "updateMs" and title.startswith("first"):
                    lists.append(f"- {side}, first view per process, `update` ms in run order: {fmt_list(values)}")
            delta = (f"{(meds['head'] / meds['base'] - 1) * 100:+.1f}%"
                     if meds["base"] and meds["head"] else "n/a")
            lines.append(f"| {title} | {name} | " + " | ".join(cells) + f" | {delta} |")
    digests = {side: {v["digest"] for d in rows[side] for v in d["views"]} for side in SIDES}
    equal = len(digests["base"]) == 1 and digests["base"] == digests["head"]
    lines += [""] + lists + [f"- Card digest over all cold views: {'equal on both sides' if equal else 'DIFFERS'}."]
    result["digestsEqual"] = equal
    return lines, result


def stall_lines(samples):
    lines = [
        "| Phase | Steps per side | Base max stall per step, median / p95 | Head max stall per step, median / p95 | Base stalls > 16.7 ms | Head stalls > 16.7 ms | Base > 33.4 ms | Head > 33.4 ms |",
        "|---|---:|---:|---:|---:|---:|---:|---:|",
    ]
    data = {}
    for key, title in PHASES:
        cells = {}
        for side in SIDES:
            records = steps(samples[side], key)
            peaks = [r.get("maxStallMs", 0) for r in records]
            cells[side] = (len(records), statistics.median(peaks) if peaks else 0, pct(peaks, 0.95) or 0,
                           sum(r.get("stalls17", 0) for r in records), sum(r.get("stalls33", 0) for r in records))
            data.setdefault(key, {})[side] = dict(zip(["steps", "medianMaxMs", "p95MaxMs", "stalls17", "stalls33"], cells[side]))
        b, h = cells["base"], cells["head"]
        lines.append(f"| {title} | {b[0]} | {b[1]:.1f} / {b[2]:.1f} ms | {h[1]:.1f} / {h[2]:.1f} ms | {b[3]} | {h[3]} | {b[4]} | {h[4]} |")
    return lines, data


def signpost_lines(out):
    lines = []
    for side in SIDES:
        path = out / f"{side}-signposts.json"
        if not path.exists():
            lines.append(f"- {side}: no trace export")
            continue
        data = json.loads(path.read_text())
        updates = [i["durationNs"] / 1e6 for i in data["intervals"]
                   if i["name"] == "sourceStateUpdate" and i["durationNs"] is not None]
        phases = [i for i in data["intervals"] if i["name"] == "phase"]
        if updates:
            lines.append(f"- {side}: {len(updates)} `sourceStateUpdate` intervals, median "
                         f"{statistics.median(updates):.3f} ms, p95 {pct(updates, 0.95):.3f} ms; {len(phases)} phase intervals")
        else:
            lines.append(f"- {side}: {len(data['intervals'])} intervals, none named sourceStateUpdate")
    return lines


def main():
    lane, out, title = sys.argv[1], Path(sys.argv[2]), sys.argv[3]
    samples = load(out)
    read = lambda name: (out / name).read_text().strip() if (out / name).exists() else "n/a"
    lines = [f"### {lane}: {title}", "", "```", read("environment.txt"), read("tree-check.txt"), "```", ""]
    for side in SIDES:
        if samples[side]:
            first = samples[side][0]
            timeouts = sum(p.get("timeouts", 0) for d in samples[side] for p in d["phases"])
            lines.append(f"- {side}: {len(samples[side])} samples, {first['historyRows']} rows at the end, "
                         f"{first['citedReplies']} cited replies with cards, {first['projectedCards']} cards, "
                         f"bounded waits that timed out: {timeouts}")
        else:
            lines.append(f"- {side}: no samples")
    if (out / "status.txt").exists() and read("status.txt"):
        lines.append(f"- failures: {read('status.txt')}")
    result = {"lane": lane}
    if samples["base"] and samples["head"]:
        rows = [("load", "load", None)] + \
            [("append", f"append: {kind}", (lambda k: lambda i: i % 3 == k)(n)) for n, kind in enumerate(APPEND_KINDS)] + \
            [("append", "append: any message", None),
             ("reloadSame", "first reload after the 21 event-delivered rows (same ids)", lambda i: i == 0),
             ("reloadSame", "later reloads, identical rows", lambda i: i > 0),
             ("reloadGrown", "reload, same ids + 1 new row", None), ("contextChange", "source context change", None)]
        table, counts = count_table(samples, rows)
        lines += ["", "#### Counts per step (median, range across all steps of all samples)", ""] + table
        table, times = time_table(samples)
        lines += ["", "#### `ChatSourcePreviewState.update` duration per call (os_signpost interval, in-process timer)",
                  ""] + table
        table, digests = digest_lines(samples)
        lines += ["", "#### Output: SHA-256 of the projected cards", ""] + table
        table, stalls = stall_lines(samples)
        lines += ["", "#### Main-thread stalls while each step runs (2 ms main-queue timer; gap = main thread busy)", ""] + table
        result["stalls"] = stalls
        result.update({"counts": counts, "times": times, "digests": digests,
                       "samples": {side: len(samples[side]) for side in SIDES}})
    table, cold = cold_lines(out)
    lines += ["", "#### Cold first projection (80 cited replies), fresh window + view model + transport per view", ""] + table
    result["cold"] = cold
    lines += ["", "#### xctrace os_signpost export (one extra run per side)", ""] + signpost_lines(out)
    (out / "counts.json").write_text(json.dumps(result, indent=2, sort_keys=True))
    print("\n".join(lines))


if __name__ == "__main__":
    main()
