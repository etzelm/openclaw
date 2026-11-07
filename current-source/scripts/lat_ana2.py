# usage: python3 -I lat_ana2.py <results-dir> : for runs net-<arm>-N<n>, per shape (sparse, cli) and concurrency (1, 8),
# median and range across runs of the per-run p50/p95/p99, request counts, errors, and the 1-minute load recorded.
import glob, json, re, statistics, sys
root = sys.argv[1]
def runs(arm): return sorted(glob.glob(f'{root}/net-{arm}-N*'), key=lambda p: int(re.search(r'N(\d+)$', p).group(1)))
for label in ('sparse', 'cli'):
    for c in ('1', '8'):
        med = {}
        for arm in ('base', 'fix'):
            rows = []
            for d in runs(arm):
                try: rows.append(json.load(open(f'{d}/load-{label}-c{c}.json')))
                except FileNotFoundError: pass
            if not rows: continue
            ops = [r['perOp']['chat.history'] for r in rows]
            out = {'runs': len(rows), 'requests': sum(o['n'] for o in ops), 'errors': sum(o['errors'] for o in ops)}
            for k in ('p50', 'p95', 'p99'):
                v = [o[k] for o in ops]; med[(arm, k)] = statistics.median(v)
                out[k] = f'{statistics.median(v):.2f} ({min(v):.2f} to {max(v):.2f})'
            out['load1'] = f"{min(min(r['load1']) for r in rows):.1f} to {max(max(r['load1']) for r in rows):.1f}"
            print(f'{label} c{c} {arm}', json.dumps(out))
        if ('base', 'p50') in med and ('fix', 'p50') in med:
            print(f'{label} c{c} delta(base-fix) p50 {med[("base","p50")]-med[("fix","p50")]:.2f} ms, p95 {med[("base","p95")]-med[("fix","p95")]:.2f} ms')
