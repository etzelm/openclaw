#!/usr/bin/env python3
# Mutation matrix: each mutation applied alone, the 9 owning test files run, failing cases recorded,
# production restored with git checkout, tree verified clean. Usage: matrix.py OUTDIR [ids...]
import os, re, subprocess, sys, time, json
REPO = os.path.expanduser("~/work/pr-164796-simplify3")
OUT = sys.argv[1]
only = set(sys.argv[2:])
exec(open(os.path.expanduser("~/work/s3scripts/mutations.py")).read())
# One invocation per runner shard: the runner stops after the first failing shard.
GROUPS = [["src/agents/cli-runner/history-boundary.test.ts", "src/agents/cli-runner/history-boundary.incognito.test.ts"], ["src/plugin-sdk/provider-auth-claude-compat.test.ts"],
          ["src/agents/cli-credentials.test.ts"], ["extensions/anthropic/cli-runtime.test.ts"],
          ["src/agents/cli-runner/execute-plugin.test.ts", "src/agents/cli-runner/cli-live-session-registry.test.ts",
           "src/agents/cli-runner/history-boundary.native-login.test.ts", "src/agents/cli-runner/execute.native-history-owner.test.ts",
           "src/agents/cli-runner/prepare-native-history.test.ts"]]
env = dict(os.environ, PATH=os.path.expanduser("~/homebrew/bin") + ":" + os.environ["PATH"], OPENCLAW_VITEST_MAX_WORKERS="4")
ansi = re.compile(r"\x1b\[[0-9;]*m")
os.makedirs(OUT, exist_ok=True)
def git(*a):
    return subprocess.run(["git", *a], cwd=REPO, capture_output=True, text=True).stdout
def run_tests(label):
    log = os.path.join(OUT, label + ".log")
    t = time.time()
    rc = 0
    with open(log, "w") as fh:
        for group in GROUPS:
            fh.write("### GROUP " + " ".join(group) + "\n"); fh.flush()
            rc |= subprocess.run(["perl", "-e", "alarm 900; exec @ARGV", "pnpm", "test", *group, "--", "--reporter=verbose"],
                                 cwd=REPO, env=env, stdout=fh, stderr=subprocess.STDOUT).returncode
    text = ansi.sub("", open(log, errors="replace").read())
    failed = sorted({re.sub(r"\s+\d+(\.\d+)?m?s$", "", l.strip()[1:].strip()) for l in text.splitlines() if l.strip().startswith("×")})
    failed_files = sorted({l.strip() for l in text.splitlines() if l.strip().startswith("FAIL ") and ">" not in l})
    summary = [l.strip() for l in text.splitlines() if re.match(r"\s*(Test Files|Tests)\s", l)]
    return rc, failed, failed_files, summary, round(time.time() - t)
results = []
assert git("status", "--porcelain") == "", "dirty before start"
if only == {"GREEN"}:
    rc, failed, ffiles, summary, secs = run_tests("GREEN")
    json.dump({"rc": rc, "failed": failed, "summary": summary, "secs": secs}, open(os.path.join(OUT, "green.json"), "w"), indent=1)
    print("GREEN rc", rc, "failed", len(failed), "secs", secs); sys.exit(rc)
for mid, desc, edits in M:
    if only and mid not in only:
        continue
    ok = True
    for f, old, new in edits:
        p = os.path.join(REPO, f); s = open(p).read()
        if s.count(old) != 1:
            ok = False; print(mid, "NOAPPLY", f, s.count(old), flush=True); break
        open(p, "w").write(s.replace(old, new))
    if not ok:
        git("checkout", "-q", "--", ".")
        results.append({"id": mid, "desc": desc, "applied": False}); continue
    diffstat = git("diff", "--shortstat").strip()
    rc, failed, ffiles, summary, secs = run_tests(mid)
    git("checkout", "-q", "--", ".")
    clean = git("status", "--porcelain") == ""
    r = {"id": mid, "desc": desc, "applied": True, "diffstat": diffstat, "rc": rc, "failed": failed,
         "failed_files": ffiles, "summary": summary, "secs": secs, "clean_after": clean}
    results.append(r)
    print(mid, "rc", rc, "failed", len(failed), "files", len(ffiles), "secs", secs, "clean", clean, flush=True)
    json.dump(results, open(os.path.join(OUT, "matrix.json"), "w"), indent=1)
    if not clean:
        print("DIRTY, stopping"); sys.exit(1)
json.dump(results, open(os.path.join(OUT, "matrix.json"), "w"), indent=1)
print("DONE")
