# usage: python3 -I lat_ana.py <results-dir> <prefix> : per arm, median and range across runs of the closed-loop
# chat.history latency (concurrency 1, 20 s) in <run>/load.json for runs named <prefix>-<arm>-L<n>.
import glob, json, statistics, sys
root, prefix = sys.argv[1], sys.argv[2]
for arm in ('base', 'fix'):
    runs = sorted(glob.glob(f'{root}/{prefix}-{arm}-L*/load.json'))
    rows = [json.load(open(p))['perOp']['chat.history'] for p in runs]
    if not rows: continue
    out = {'runs': len(rows), 'requests': sum(r['n'] for r in rows), 'errors': sum(r['errors'] for r in rows)}
    for k in ('p50', 'p95', 'p99'):
        v = [r[k] for r in rows]; out[k] = f'{statistics.median(v):.2f} ({min(v):.2f} to {max(v):.2f})'
    print(arm, json.dumps(out))
