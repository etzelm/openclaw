# usage: python3 -I profcmp.py <W> <tagA-prefix> <tagB-prefix> [top]
# e.g. profcmp.py <bench-dir> p1-m p1-a 40
# Per build: transcript worker CPU profile time per function (self and inclusive), divided by the number of
# transcript worker requests in the same runs (h8.prom.after, cumulative since boot, warmup + h8).
# Prints functions sorted by the B-minus-A difference in microseconds per worker request.
import sys, os, glob, json, re, collections

W, A, B = sys.argv[1], sys.argv[2], sys.argv[3]
top = int(sys.argv[4]) if len(sys.argv) > 4 else 40
SPECIAL = ("(idle)", "(program)", "(root)")
CNT = re.compile(r'^openclaw_worker_request_seconds_count\{kind="sessionTranscript",request_class="task"\}\s+(\S+)')


def key(n):
    cf = n["callFrame"]
    fn = cf["functionName"] or "(anon)"
    if fn.startswith("("):
        return fn
    u = re.sub(r"-[A-Za-z0-9_]{8}\.mjs$", ".mjs", os.path.basename(cf.get("url") or ""))
    return "%s %s" % (fn, u)


def build(prefix):
    self_t, incl = collections.Counter(), collections.Counter()
    reqs = 0
    runs = sorted(glob.glob(os.path.join(W, "prof", prefix + "*")))
    for rd in runs:
        tag = os.path.basename(rd)
        for l in open(os.path.join(W, "results", tag, "h8.prom.after")):
            m = CNT.match(l)
            if m:
                reqs += float(m.group(1))
        for p in glob.glob(os.path.join(rd, "*.cpuprofile")):
            pr = json.load(open(p))
            if not any("session-transcript.worker" in (n["callFrame"].get("url") or "") for n in pr["nodes"]):
                continue
            nodes = {n["id"]: n for n in pr["nodes"]}
            parent = {c: n["id"] for n in pr["nodes"] for c in n.get("children", [])}
            dt = collections.Counter()
            for s, t in zip(pr["samples"], pr["timeDeltas"]):
                dt[s] += t
            for nid, us in dt.items():
                k = key(nodes[nid])
                self_t[k] += us
                if k in SPECIAL:
                    continue
                self_t["(busy)"] += us
                seen, x = set(), nid
                while x is not None:
                    kk = key(nodes[x])
                    if kk not in seen:
                        incl[kk] += us
                        seen.add(kk)
                    x = parent.get(x)
    return runs, reqs, self_t, incl


ra, na, sa, ia = build(A)
rb, nb, sb, ib = build(B)
print("A=%s runs=%d worker_requests=%d busy_us_per_req=%.1f" % (A, len(ra), na, sa["(busy)"] / na))
print("B=%s runs=%d worker_requests=%d busy_us_per_req=%.1f" % (B, len(rb), nb, sb["(busy)"] / nb))
for title, xa, xb in (("self", sa, sb), ("inclusive", ia, ib)):
    print("## %s, us per worker request: A  B  B-A" % title)
    keys = set(xa) | set(xb)
    rows = sorted(keys, key=lambda k: -abs(xb[k] / nb - xa[k] / na))
    for k in rows[:top]:
        print("%8.1f %8.1f %+8.1f  %s" % (xa[k] / na, xb[k] / nb, xb[k] / nb - xa[k] / na, k))
