#!/usr/bin/env python3
# usage: record-p3.py queued|note <run dir> [worker command log]
# One readable record for the queued-reassign (scenario 22) and note (row 32) runs.
import json, os, re, sys, glob

kind, d = sys.argv[1], sys.argv[2]
home = os.path.expanduser("~")

def lines(p):
    return open(p).read().splitlines() if os.path.exists(p) else []

def turn_logs(pattern):
    for e in sorted(glob.glob(f"{d}/turn*.err"), key=lambda p: int(re.search(r"turn(\d+)", p).group(1))):
        n = re.search(r"turn(\d+)", e).group(1)
        yield n, [re.sub(r"^\[[^]]*\] ", "", l)[:400] for l in lines(e) if re.search(pattern, l)]

def users():
    files = glob.glob(f"{d}/fake-claude.log.user-*.txt")
    return sorted(files, key=os.path.getmtime)

def transcript_rows():
    return [l for l in lines(f"{d}/transcript-and-boundary.txt") if " seq=" in l or l.startswith("seq=")]

if kind == "queued":
    print("######## after / queued-reassign")
    print("\n".join(l for l in lines(f"{d}/turns.log") if re.match(r"^turn \d+ exit", l)))
    for n, ls in turn_logs(r"cli exec|refused across"):
        print(f"[turn{n} openclaw log]"); print("\n".join(ls))
    print("[prompt canaries per user message]")
    for u in users():
        t = open(u).read()
        print(f"{os.path.basename(u).replace('fake-claude.log.', '')}: chars={len(t.encode())} PINEAPPLE-7={t.count('PINEAPPLE-7')} BANANA-3={t.count('BANANA-3')} MANGO-5={t.count('MANGO-5')}")
    print("[stored boundary after each turn]"); print("\n".join(lines(f"{d}/boundary-by-turn.txt")))
    print("[worker commands around the switch]")
    for l in lines(f"{d}/queued.log"):
        r = json.loads(l)
        if r["type"].startswith("session.turn."):
            print(f"{r['event']} {r['type']}")
    print("[transcript rows after the last turn]")
    print("\n".join(re.sub(r"^session=\S+ ", "", l) for l in transcript_rows()))
else:
    log = sys.argv[3]
    turns = {}
    for l in lines(log):
        r = json.loads(l)
        if r.get("event") != "worker-command-queued":
            continue
        turns.setdefault(r["pid"], []).append(r["type"])
    for i, (pid, types) in enumerate(turns.items(), 1):
        counts = {}
        for t in types:
            counts[t] = counts.get(t, 0) + 1
        print(f"turn {i}: " + ", ".join(t if c == 1 else f"{t} x{c}" for t, c in counts.items()))
    print("---")
    for n, ls in turn_logs(r"cli exec|refused across"):
        if n == "2":
            print(f"[turn{n} log]"); print("\n".join(ls))
    print("[transcript rows after turn 2]")
    import subprocess
    db = glob.glob(f"{d}/state/agents/*/agent/openclaw-agent.sqlite")[0]
    print(subprocess.run(["node", os.path.join(os.path.dirname(__file__), "rows-all.mjs"), db], capture_output=True, text=True).stdout.rstrip())
    print("[stored boundary after each turn]"); print("\n".join(lines(f"{d}/boundary-by-turn.txt")))
