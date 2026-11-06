#!/usr/bin/env python3
"""Summarize the p1 base vs head workload samples as Markdown and counts.json.

Usage: summarize.py <lane> <out dir> <title>
"""
import json
import statistics
import sys
from pathlib import Path

PHASES = ["load", "scroll", "resize", "append", "stream"]
KEY = [
    ("messageRow.splitRow", "split rows evaluated by `ChatView.messageRow`"),
    ("rowSourcePreviews@messageRow", "`ChatSourcePreviewState.previews(for:)` under messageRow"),
    ("citationParse@messageRow", "`ChatSourcePreviewProjector.citations(in:)` under messageRow"),
    ("previewURLDocumentParse@messageRow", "`Document(parsing:)` (link scan) under messageRow"),
    ("citationParse", "`citations(in:)` from all callers (incl. projection in `update`)"),
]


def pct(values, q):
    ordered = sorted(values)
    if not ordered:
        return float("nan")
    index = min(len(ordered) - 1, max(0, round(q * (len(ordered) - 1))))
    return ordered[index]


def load(out):
    variants = {}
    for path in sorted((out / "samples").glob("*.json")):
        data = json.loads(path.read_text())
        if data.get("sample") == "trace":
            continue
        sides = variants.setdefault(data.get("variant", "cards"), {"base": [], "head": []})
        sides.setdefault(data["label"], []).append(data)
    return variants


def phase_values(samples, side, phase, label):
    return [p["counts"].get(label, 0) for d in samples[side] for p in d["phases"] if p["name"] == phase]


def phase_ms(samples, side, phase):
    return [p["ms"] for d in samples[side] for p in d["phases"] if p["name"] == phase]


def med(values, fmt="{:g}"):
    return fmt.format(statistics.median(values)) if values else "n/a"


def span(values):
    return f"{min(values):g}..{max(values):g}" if values else "n/a"


def key_table(samples, counts):
    lines = [
        "| Phase | Measure | Base median | Head median | Base range | Head range |",
        "|---|---|---:|---:|---|---|",
    ]
    for phase in PHASES:
        for label, text in KEY:
            base = phase_values(samples, "base", phase, label)
            head = phase_values(samples, "head", phase, label)
            counts.setdefault(phase, {})[label] = {"base": base, "head": head}
            lines.append(f"| {phase} | {text} | {med(base)} | {med(head)} | {span(base)} | {span(head)} |")
        base = phase_ms(samples, "base", phase)
        head = phase_ms(samples, "head", phase)
        counts[phase]["wallMs"] = {"base": base, "head": head}
        lines.append(
            f"| {phase} | wall time ms (median, p95) | {med(base, '{:.1f}')} (p95 {pct(base, 0.95):.1f}) | "
            f"{med(head, '{:.1f}')} (p95 {pct(head, 0.95):.1f}) | | |")
    return lines


def totals(samples):
    lines = ["| Calls over the whole workload | Base (median) | Head (median) |", "|---|---:|---:|"]
    labels = sorted({k for side in samples.values() for d in side for p in d["phases"] for k in p["counts"]})
    for label in labels:
        cells = []
        for side in ("base", "head"):
            values = [sum(p["counts"].get(label, 0) for p in d["phases"]) for d in samples[side]]
            cells.append(f"{statistics.median(values):g}" if values else "n/a")
        lines.append(f"| `{label}` | {cells[0]} | {cells[1]} |")
    return lines


def output_check(samples):
    hashes = {side: sorted({d.get("renderedRowsSHA256", "missing") for d in samples[side]}) for side in ("base", "head")}
    same = len(hashes["base"]) == 1 and hashes["base"] == hashes["head"] and hashes["base"] != ["missing"]
    first = (samples["base"] or samples["head"])[0]
    changes = {side: [d.get("renderedRowCardChanges") for d in samples[side]] for side in ("base", "head")}
    return same, [
        f"- rendered row keys: {first.get('renderedRowKeys')}, split rows: {first.get('renderedSplitRows')}, "
        f"split rows with cards: {first.get('renderedSplitRowsWithCards')}",
        f"- per-row cards SHA-256, base: {', '.join(h[:16] for h in hashes['base'])}; "
        f"head: {', '.join(h[:16] for h in hashes['head'])} -> {'IDENTICAL' if same else 'DIFFERENT'}",
        f"- rows whose cards changed between renders within a sample: base {changes['base']}, head {changes['head']}",
    ]


def profile_lines(out):
    lines = []
    for side in ("base", "head"):
        path = out / f"{side}-timeprofile.json"
        if not path.exists():
            lines.append(f"- {side}: no time profile export")
            continue
        try:
            data = json.loads(path.read_text())
        except ValueError:
            lines.append(f"- {side}: time profile export failed (see trace-status.txt)")
            continue
        lines.append(f"- {side}: {data.get('samples', 0)} main-thread samples in the workload process (cards transcript)")
        for name, value in data.get("stacks", {}).items():
            lines.append(f"  - samples with `{name}` on the stack: {value}")
    return lines


def main():
    lane, out, title = sys.argv[1], Path(sys.argv[2]), sys.argv[3]
    variants = load(out)
    env = (out / "environment.txt").read_text().strip() if (out / "environment.txt").exists() else "n/a"
    lines = [f"### {lane}: {title}", "", "```", env, "```", ""]
    for side in ("base", "head"):
        focused = out / f"{side}-focused.txt"
        text = focused.read_text().strip() if focused.exists() else "not run"
        text = " ".join(line.strip() for line in text.splitlines() if "Test run with" in line) or text
        lines.append(f"- {side} focused suites (unmodified code): {text or 'no result line'}")
    status = out / "status.txt"
    if status.exists() and status.read_text().strip():
        lines.append(f"- failures: {status.read_text().strip()}")
    counts = {}
    all_same = True
    for variant in sorted(variants):
        samples = variants[variant]
        lines += ["", f"#### Transcript `{variant}`", ""]
        for side in ("base", "head"):
            if samples[side]:
                first = samples[side][0]
                lines.append(
                    f"- {side}: {len(samples[side])} samples (sample order {', '.join(d['sample'] for d in samples[side])}), "
                    f"{first['historyRows']} history messages, {first['projectedCards']} projected cards")
            else:
                lines.append(f"- {side}: no samples")
        if samples["base"] and samples["head"]:
            same, check = output_check(samples)
            all_same = all_same and same
            lines += check + [""] + key_table(samples, counts.setdefault(variant, {}))
            lines += ["", "<details><summary>All probe counts, whole workload</summary>", ""] + totals(samples)
            lines += ["", "</details>"]
    lines += ["", "#### Time Profiler (xctrace attached to the workload process, one extra run per side)", ""]
    lines += profile_lines(out)
    (out / "counts.json").write_text(json.dumps({"lane": lane, "outputIdentical": all_same, "variants": counts}, indent=2))
    print("\n".join(lines))


if __name__ == "__main__":
    main()
