#!/usr/bin/env python3
"""Summarize the p3 proof samples into summary.md (stdout) and counts.json.

Usage: summarize.py <lane> <out dir> <title>
"""
import json
import statistics
import sys
from pathlib import Path

PHASES = ["load", "scroll", "resize", "append", "stream", "bubbleScan", "openGraphParse"]
FAMILIES = ["bareURL", "externalFrame", "htmlAttribute", "htmlTitle", "htmlEntity", "other"]
WORK = ["bareURLTextScan", "externalFrameStrip", "openGraphParse", "rowLinkPreviewURL", "markdownURLScan"]


def pct(values, q):
    ordered = sorted(values)
    if not ordered:
        return float("nan")
    index = min(len(ordered) - 1, max(0, round(q * (len(ordered) - 1))))
    return ordered[index]


def spread(values):
    if not values:
        return "n/a"
    med = statistics.median(values)
    lo, hi = min(values), max(values)
    return f"{med:g}" if lo == hi else f"{med:g} ({lo:g} to {hi:g})"


def load(out):
    samples = {"base": [], "head": []}
    for path in sorted((out / "samples").glob("*.json")):
        data = json.loads(path.read_text())
        if data.get("sample") == "trace":
            continue
        samples.setdefault(data["label"], []).append(data)
    return samples


def counts(sample, phase, key):
    for p in sample["phases"]:
        if p["name"] == phase:
            return p["counts"].get(key, 0)
    return 0


def main():
    lane, out, title = sys.argv[1], Path(sys.argv[2]), sys.argv[3]
    samples = load(out)
    lines = [f"### {lane}: {title}", ""]
    env = out / "environment.txt"
    lines += ["```", env.read_text().strip() if env.exists() else "n/a", "```", ""]
    tree = out / "tree-check.txt"
    if tree.exists():
        lines.append(f"- {tree.read_text().strip().splitlines()[0]}")
    for side in ("base", "head"):
        focused = out / f"{side}-focused.txt"
        text = focused.read_text().strip() if focused.exists() else "run in the separate focused job"
        lines.append(f"- {side} focused suites (unmodified code): {text or 'no result line'}")
    for side in ("base", "head"):
        s = samples[side]
        if s:
            lines.append(
                f"- {side}: {len(s)} samples, {s[0]['historyRows']} history rows, {s[0]['projectedCards']} source cards, "
                f"{s[0].get('bubbleTexts', 'n/a')} user/assistant bubbles, regex counting {s[0]['regexCounting']}")
        else:
            lines.append(f"- {side}: no samples")
    status = out / "status.txt"
    if status.exists() and status.read_text().strip():
        lines.append(f"- failures: {status.read_text().strip()}")

    result = {"lane": lane, "samples": {k: len(v) for k, v in samples.items()}, "phases": {}}
    if not (samples["base"] and samples["head"]):
        print("\n".join(lines))
        (out / "counts.json").write_text(json.dumps(result, indent=2) + "\n")
        return

    keys = [f"regexCompile.{f}" for f in FAMILIES] + WORK
    lines += ["", "#### NSRegularExpression compiles per workload phase (median over samples, range if it varied)", "",
              "| Phase | Pattern family | Base compiles | Head compiles | Work done (base / head) |",
              "|---|---|---:|---:|---|"]
    work_for = {"bareURL": "bareURLTextScan", "externalFrame": "externalFrameStrip",
                "htmlAttribute": "openGraphParse", "htmlTitle": "openGraphParse", "htmlEntity": "openGraphParse"}
    for phase in PHASES:
        result["phases"][phase] = {}
        for key in keys:
            result["phases"][phase][key] = {
                side: [counts(s, phase, key) for s in samples[side]] for side in ("base", "head")}
        for family in FAMILIES:
            key = f"regexCompile.{family}"
            base = result["phases"][phase][key]["base"]
            head = result["phases"][phase][key]["head"]
            if not any(base) and not any(head):
                continue
            work = work_for.get(family)
            work_text = "n/a"
            if work:
                wb = result["phases"][phase][work]["base"]
                wh = result["phases"][phase][work]["head"]
                work_text = f"{spread(wb)} / {spread(wh)} `{work}` calls"
            lines.append(f"| {phase} | `{family}` | {spread(base)} | {spread(head)} | {work_text} |")

    lines += ["", "#### Whole workload per process", "", "| Pattern family | Base compiles | Head compiles |",
              "|---|---:|---:|"]
    result["totals"] = {}
    for family in FAMILIES:
        key = f"regexCompile.{family}"
        per = {side: [sum(counts(s, p, key) for p in PHASES) for s in samples[side]] for side in ("base", "head")}
        result["totals"][key] = per
        if any(per["base"]) or any(per["head"]):
            lines.append(f"| `{family}` | {spread(per['base'])} | {spread(per['head'])} |")

    # Output equality.
    lines += ["", "#### Output unchanged", ""]
    digests = {side: {s["rowsSHA256"] for s in samples[side] if "rowsSHA256" in s} for side in ("base", "head")}
    og = {side: {tuple(s.get("openGraphResults", [])) for s in samples[side]} for side in ("base", "head")}
    shots = {side: [s.get("screenshotSHA256", "none") for s in samples[side]] for side in ("base", "head")}
    rows = len(samples["base"][0].get("rowSHA256", []))
    equal_rows = digests["base"] == digests["head"] and len(digests["base"]) == 1
    lines.append(f"- Per-row fingerprint (bubble link preview URL, all preview URLs, source cards) for {rows} rows: "
                 f"base {sorted(digests['base'])}, head {sorted(digests['head'])}: "
                 f"{'EQUAL' if equal_rows else 'DIFFERENT'}")
    if not equal_rows and samples["base"][0].get("rowSHA256") and samples["head"][0].get("rowSHA256"):
        diff = [i for i, (a, b) in enumerate(zip(samples["base"][0]["rowSHA256"], samples["head"][0]["rowSHA256"]))
                if a != b]
        lines.append(f"  - differing rows (sample 1): {diff[:20]}")
    equal_og = og["base"] == og["head"] and len(og["base"]) == 1
    lines.append(f"- Open Graph results (og:title fixture, title fallback fixture): "
                 f"{'EQUAL' if equal_og else 'DIFFERENT'}: `{samples['base'][0].get('openGraphResultText')}`")
    shared = set(shots["base"]) & set(shots["head"])
    lines.append(f"- Transcript screenshot PNG SHA-256: base {sorted(set(shots['base']))}, head {sorted(set(shots['head']))}"
                 f" ({'identical bytes on both sides' if shared else 'no byte-identical pair'})")
    result["output"] = {"rowsEqual": equal_rows, "openGraphEqual": equal_og, "rowDigests": {k: sorted(v) for k, v in digests.items()},
                        "screenshots": shots, "screenshotByteIdentical": bool(shared), "rows": rows}

    # Timings (bonus).
    lines += ["", "#### Timings (bonus; counts are the claim)", "",
              "| Measure | Base median | Base p95 | Head median | Head p95 | Median change |", "|---|---:|---:|---:|---:|---:|"]
    result["timings"] = {}

    def row(name, base, head, unit):
        if not base or not head:
            return
        bm, hm = statistics.median(base), statistics.median(head)
        result["timings"][name] = {"base": {"median": bm, "p95": pct(base, 0.95), "n": len(base)},
                                   "head": {"median": hm, "p95": pct(head, 0.95), "n": len(head)}}
        lines.append(f"| {name} ({unit}, n={len(base)}/{len(head)}) | {bm:.1f} | {pct(base, 0.95):.1f} | {hm:.1f} | "
                     f"{pct(head, 0.95):.1f} | {(hm - bm) / bm * 100:+.1f}% |")

    for key, label in (("bubbleScanPassUs", "chatFirstPreviewURL over every bubble, per pass"),
                       ("openGraphParseUs", "parseChatOpenGraph per call")):
        row(label, [v for s in samples["base"] for v in s.get("timings", {}).get(key, [])],
            [v for s in samples["head"] for v in s.get("timings", {}).get(key, [])], "us")
    for phase in PHASES:
        row(f"phase {phase}", [p["ms"] for s in samples["base"] for p in s["phases"] if p["name"] == phase],
            [p["ms"] for s in samples["head"] for p in s["phases"] if p["name"] == phase], "ms")
    for name in ("load-before.txt", "load-after.txt"):
        path = out / name
        if path.exists():
            lines.append(f"\n- {name[:-4]}: {path.read_text().strip()}")

    (out / "counts.json").write_text(json.dumps(result, indent=2) + "\n")
    print("\n".join(lines))


if __name__ == "__main__":
    main()
