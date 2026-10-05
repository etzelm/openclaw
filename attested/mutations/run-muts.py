#!/usr/bin/env python3
# Applies each mutation alone to the checkout, runs each owning test file alone, records exit codes
# and failing test names, then restores the file and checks the tree is clean.
import json, os, re, subprocess, sys
repo = os.path.expanduser("~/work/164796-c/repo")
out = os.path.expanduser("~/work/164796-c/muts-out")
os.makedirs(os.path.join(out, "logs"), exist_ok=True)
muts = json.load(open(os.path.expanduser("~/work/164796-c/muts.json")))
env = dict(os.environ, OPENCLAW_VITEST_MAX_WORKERS="8")
results = []
for m in muts:
    path = os.path.join(repo, m["file"])
    src = open(path).read()
    edits = m.get("edits") or [{"old": m["old"], "new": m["new"]}]
    if any(src.count(e["old"]) != 1 for e in edits):
        results.append({"id": m["id"], "origin": m.get("origin"), "applicable": False})
        print(m["id"], "not applicable", flush=True); continue
    for e in edits:
        src = src.replace(e["old"], e["new"])
    open(path, "w").write(src)
    diff = subprocess.run(["git", "diff", "--", m["file"]], cwd=repo, capture_output=True, text=True).stdout
    open(os.path.join(out, m["id"] + ".diff.txt"), "w").write(diff)
    exits = {}; failed = []
    for t in m["tests"]:
        log = os.path.join(out, "logs", f'{m["id"]}.{os.path.basename(t).replace(".ts","")}.log')
        with open(log, "w") as fh:
            fh.write("$ pnpm test " + t + "\n"); fh.flush()
            try:
                r = subprocess.run(["pnpm", "test", t], cwd=repo, stdout=fh, stderr=subprocess.STDOUT, env=env, timeout=900)
                code = r.returncode
            except subprocess.TimeoutExpired:
                code = "timeout"
        exits[os.path.basename(t)] = code
        text = re.sub(r"\x1b\[[0-9;]*m", "", open(log).read())
        failed += sorted(set(re.findall(r"^\s*(?:×|✗|FAIL)\s+.*?> (.+?)(?:\s+\d+ms)?$", text, re.M)))
    open(os.path.join(out, m["id"] + ".failed.txt"), "w").write("\n".join(failed) + "\n")
    subprocess.run(["git", "checkout", "--", m["file"]], cwd=repo)
    clean = subprocess.run(["git", "status", "--porcelain"], cwd=repo, capture_output=True, text=True).stdout.strip() == ""
    red = any(c != 0 for c in exits.values())
    results.append({"id": m["id"], "origin": m.get("origin"), "applicable": True, "exits": exits, "red": red, "failedTests": len(failed), "cleanAfter": clean})
    print(m["id"], exits, "red" if red else "GREEN", "clean" if clean else "DIRTY", flush=True)
    if not clean:
        sys.exit("checkout dirty after " + m["id"])
json.dump(results, open(os.path.join(out, "results.json"), "w"), indent=1)
open(os.path.join(out, "done"), "w").write("ok\n")
