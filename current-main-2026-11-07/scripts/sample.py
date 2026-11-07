# usage: python3 -I sample.py <gateway_root_pid> <pg_postmaster_pid|0> <interval_s> <out_csv> <stop_file>
# Samples RSS (KiB) + cumulative CPU seconds of the gateway process tree and the postgres tree,
# plus postgres client-backend count (processes whose title contains "openclaw_runtime").
import subprocess, sys, time, os
gw, pg, iv, out, stop = int(sys.argv[1]), int(sys.argv[2]), float(sys.argv[3]), sys.argv[4], sys.argv[5]
def cpu_s(t):
    d = 0
    if '-' in t: d, t = t.split('-'); d = int(d)
    p = [float(x) for x in t.split(':')]
    while len(p) < 3: p.insert(0, 0.0)
    return d*86400 + p[0]*3600 + p[1]*60 + p[2]
def tree(rows, root):
    kids = {}
    for pid, ppid, *_ in rows: kids.setdefault(ppid, []).append(pid)
    seen, st = set(), [root]
    while st:
        x = st.pop()
        if x in seen: continue
        seen.add(x); st += kids.get(x, [])
    return seen
with open(out, 'w') as f:
    f.write('t,gw_procs,gw_rss_kib,gw_cpu_s,pg_procs,pg_rss_kib,pg_cpu_s,pg_runtime_conns\n')
    t0 = time.time()
    while not os.path.exists(stop):
        o = subprocess.run(['ps', '-axo', 'pid=,ppid=,rss=,time=,command='], capture_output=True, text=True).stdout
        rows = []
        for line in o.splitlines():
            p = line.split(None, 4)
            if len(p) < 4: continue
            rows.append((int(p[0]), int(p[1]), int(p[2]), cpu_s(p[3]), p[4] if len(p) > 4 else ''))
        g = tree(rows, gw); q = tree(rows, pg) if pg else set()
        gr = [r for r in rows if r[0] in g]; qr = [r for r in rows if r[0] in q]
        conns = sum(1 for r in qr if 'openclaw_runtime' in r[4])
        f.write(f'{time.time()-t0:.1f},{len(gr)},{sum(r[2] for r in gr)},{sum(r[3] for r in gr):.2f},{len(qr)},{sum(r[2] for r in qr)},{sum(r[3] for r in qr):.2f},{conns}\n')
        f.flush()
        if not any(r[0] == gw for r in rows): break
        time.sleep(iv)
