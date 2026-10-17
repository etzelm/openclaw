"""Redact one run directory's logs for publication.

Usage: python3 -I redact.py <raw-run-dir> <published-run-dir>

Machine-specific values come from the environment so that this script holds none:
  REDACT_AFTER_TREE, REDACT_BEFORE_TREE  checkout paths of the two arms
  REDACT_RUN_ROOT                        parent directory of the raw run directories
  REDACT_HARNESS                         directory holding the observer
  REDACT_HOST                            host name (also matched with a .local suffix)
  REDACT_USER                            account or person name to mask anywhere

Also replaced, by pattern: any remaining home directory, temp directories, the
per-run qa-lab temp root, loopback addresses with ports, any other dotted quad,
and key-shaped strings. Run ids, session ids and conversation refs come from a
fresh temporary state directory created for each run and are kept.
"""
import json
import os
import re
import sys
from pathlib import Path


def literal(env_name: str, replacement: str, suffix: str = ""):
    value = os.environ.get(env_name, "").strip()
    if not value:
        return None
    return (re.compile(re.escape(value) + suffix, re.I), replacement)


RULES = [
    (re.compile(r"\x1b\[[0-9;]*m"), ""),
    # The Gateway prints a NUL inside one scheduler task name; keep it visible as text.
    (re.compile(r"\x00"), "<NUL>"),
    # Longest paths first: the before tree path extends the after tree path here.
    literal("REDACT_BEFORE_TREE", "<before-tree>"),
    literal("REDACT_AFTER_TREE", "<after-tree>"),
    literal("REDACT_RUN_ROOT", "<run-root>", r"(?:/[A-Za-z0-9_-]+)?"),
    literal("REDACT_HARNESS", "<harness>"),
    (re.compile(r"(?:/private)?/tmp/openclaw/openclaw-qa-suite-[A-Za-z0-9]+"), "<qa-temp-root>"),
    (re.compile(r"openclaw-qa-suite-[A-Za-z0-9]{6}"), "<qa-temp-root-name>"),
    (re.compile(r"/Users/[A-Za-z0-9._-]+"), "<home>"),
    (re.compile(r"(?:/private)?/var/folders/[^\s\"']+"), "<tmp>"),
    literal("REDACT_HOST", "<host>", r"(?:\.local)?"),
    literal("REDACT_USER", "<user>", r"[a-z]*"),
    (re.compile(r"\b127\.0\.0\.1:\d+"), "<loopback>:<port>"),
    (re.compile(r"\blocalhost:\d+"), "<loopback>:<port>"),
    (re.compile(r"\b127\.0\.0\.1\b"), "<loopback>"),
    # Any other dotted quad, except the V8 version string ("13.6.233.17-node.53").
    (re.compile(r"\b(?:\d{1,3}\.){3}\d{1,3}\b(?!-node)"), "<ip>"),
    (re.compile(r"\bsk-[A-Za-z0-9-]{8,}"), "<api-key>"),
]
RULES = [rule for rule in RULES if rule is not None]


def redact(text: str) -> str:
    for pattern, replacement in RULES:
        text = pattern.sub(replacement, text)
    return text


def main() -> None:
    raw, out = Path(sys.argv[1]), Path(sys.argv[2])
    out.mkdir(parents=True, exist_ok=True)
    for name in ["arm.txt", "driver.log", "observer.jsonl", "bus-messages.json", "gateway-output.log"]:
        source = raw / name
        if not source.exists():
            continue
        text = source.read_text(encoding="utf-8", errors="replace")
        if name == "bus-messages.json":
            # Keep the platform-side record of every message, without UI-only fields.
            messages = json.loads(text)
            keep = ["id", "direction", "conversation", "senderId", "text", "replyToId", "threadId", "timestamp"]
            text = json.dumps([{k: m[k] for k in keep if k in m} for m in messages], indent=2) + "\n"
        (out / name).write_text(redact(text), encoding="utf-8")


main()
