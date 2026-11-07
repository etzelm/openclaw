# usage: python3 -I ana_l3d.py <results-dir> <out-dir>
# Per run/arm latency, queue wait, handler mean, load, backends; per run memory (RSS + transcript worker heap)
# idle-before, peak under load, idle after; medians per build/engine/arm. Writes arms.tsv, memory.tsv, medians.tsv.
import sys, os, json, re, glob, statistics, csv
rd, od = sys.argv[1], sys.argv[2]
os.makedirs(od, exist_ok=True)
LINE = re.compile(r'^([a-zA-Z_:][a-zA-Z0-9_:]*)(\{[^}]*\})?\s+(\S+)')
SCRIPT = 'session-transcript.worker.js'

def prom_lines(lines):
    d = {}
    for line in lines:
        if line.startswith('#'):
            continue
        m = LINE.match(line)
        if m:
            try: d[(m.group(1), m.group(2) or '')] = float(m.group(3))
            except ValueError: pass
    return d
def prom(path): return prom_lines(open(path)) if os.path.exists(path) else {}
def labels(s): return dict(re.findall(r'(\w+)="((?:[^"\\]|\\.)*)"', s))
def total(d, name, want):
    return sum(v for (n, ls), v in d.items() if n == name and all(labels(ls).get(k) == x for k, x in want.items()))
def delta(b, a, name, want): return total(a, name, want) - total(b, name, want)
def heap(d):
    w = total(d, 'openclaw_worker_count', {'script': SCRIPT})
    s = total(d, 'openclaw_worker_heap_sampled_count', {'script': SCRIPT})
    h = total(d, 'openclaw_worker_heap_used_bytes', {'script': SCRIPT})
    return w, s, h
def timeline(path):
    snaps, cur = [], None
    for line in open(path):
        if line.startswith('@ '):
            m = re.match(r'@ (\S+) backends=(\d*)\s*(\d*) load=\{ (\S+)', line)
            cur = {'t': float(m.group(1)), 'backends': int(m.group(2)) if m.group(2) else None,
                   'active': int(m.group(3)) if m.group(3) else None, 'load1': float(m.group(4)), 'lines': []}
            snaps.append(cur)
        elif cur is not None:
            cur['lines'].append(line)
    for s in snaps:
        s['prom'] = prom_lines(s.pop('lines'))
    return snaps
def rss(path, t0):
    out = []
    for r in csv.DictReader(open(path)):
        out.append((t0 + float(r['t']), int(r['gw_rss_kib']) / 1024))
    return out
def bk(s):
    return int(s.split('\t')[0]) if s else None
mib = lambda b: round(b / 1048576, 1)

arm_rows, mem_rows = [], []
for run_dir in sorted(glob.glob(f'{rd}/*-r[0-9]')):
    if not os.path.exists(f'{run_dir}/run.json'):
        continue
    rj = json.load(open(f'{run_dir}/run.json'))
    if not rj.get('arms'):
        continue
    snaps = timeline(f'{run_dir}/timeline.txt')
    samples = rss(f'{run_dir}/samples.csv', rj['gwStartEpoch'])
    for arm in rj['arms']:
        n = arm['name']; d = json.load(open(f'{run_dir}/{n}.json')); h = d['perOp'].get('chat.history', {})
        calls = h.get('n') or 0
        b, a = prom(f'{run_dir}/{n}.prom.before'), prom(f'{run_dir}/{n}.prom.after')
        want = {'kind': 'sessionTranscript'}
        qn, qs = delta(b, a, 'openclaw_worker_queue_wait_seconds_count', want), delta(b, a, 'openclaw_worker_queue_wait_seconds_sum', want)
        hn = delta(b, a, 'openclaw_gateway_rpc_handler_seconds_count', {'method': 'chat.history'})
        hs = delta(b, a, 'openclaw_gateway_rpc_handler_seconds_sum', {'method': 'chat.history'})
        win = [s for s in snaps if arm['start'] <= s['t'] <= arm['end']]
        wr = [r for t, r in samples if arm['start'] <= t <= arm['end']]
        arm_rows.append({
            'run': rj['label'], 'src': rj['src'], 'engine': rj['engine'], 'arm': n, 'conc': arm['conc'],
            'calls': calls, 'rps': d.get('rps'), 'errors': h.get('errors'),
            'p50': h.get('p50'), 'p95': h.get('p95'), 'p99': h.get('p99'), 'mean': h.get('mean'),
            'queue_wait_ms_per_request': round(qs / qn * 1000, 2) if qn else None,
            'worker_requests_per_call': round(qn / calls, 2) if calls else None,
            'handler_mean_ms': round(hs / hn * 1000, 2) if hn else None,
            'load1_start': float(arm['loadavg'][0].strip('{} ').split()[0]), 'load1_end': float(arm['loadavg'][1].strip('{} ').split()[0]),
            'rss_peak_mib': round(max(wr), 1) if wr else None,
            'backends_peak': max((s['backends'] for s in win if s['backends'] is not None), default=None),
            'transcript_workers_peak': max((heap(s['prom'])[0] for s in win), default=None),
        })
    load_start = rj['arms'][0]['start'] - 25; load_end = rj['arms'][-1]['end']
    win = [s for s in snaps if load_start <= s['t'] <= load_end]
    hp = [heap(s['prom']) for s in win if heap(s['prom'])[1]]
    peak = max(hp, key=lambda x: x[2], default=(None, None, 0))
    def idle(name, key):
        w, s, hb = heap(prom(f'{run_dir}/{name}.prom'))
        return {f'{key}_workers': w, f'{key}_heap_mib': mib(hb), f'{key}_heap_per_worker_mib': mib(hb / s) if s else None}
    def rss_at(t):
        c = [r for tt, r in samples if abs(tt - t) <= 3]
        return round(c[-1], 1) if c else None
    lw = [r for t, r in samples if load_start <= t <= load_end]
    end_t = rj['arms'][-1]['end']
    mem_rows.append({
        'run': rj['label'], 'src': rj['src'], 'engine': rj['engine'],
        'rss_idle_before_mib': rss_at(rj['arms'][0]['start'] - 26), 'rss_peak_load_mib': round(max(lw), 1) if lw else None,
        'rss_idle10_mib': rss_at(end_t + 10), 'rss_idle45_mib': rss_at(end_t + 45), 'rss_idle100_mib': rss_at(end_t + 100), 'rss_idle300_mib': rss_at(end_t + 300),
        **idle('idle0', 'before'),
        'peak_workers': peak[0], 'peak_heap_mib': mib(peak[2]), 'peak_heap_per_worker_mib': mib(peak[2] / peak[1]) if peak[1] else None,
        **idle('idle10', 'idle10'), **idle('idle45', 'idle45'), **idle('idle100', 'idle100'), **idle('idle300', 'idle300'),
        'backends_before': bk(rj.get('backendsIdle0')), 'backends_peak_load': max((s['backends'] for s in win if s['backends'] is not None), default=None),
        'backends_idle10': bk(rj.get('backendsIdle10')), 'backends_idle45': bk(rj.get('backendsIdle45')), 'backends_idle100': bk(rj.get('backendsIdle100')), 'backends_idle300': bk(rj.get('backendsIdle300')),
        'load1_start': float(rj['loadavgStart'].strip('{} ').split()[0]),
    })
def write(rows, path):
    if not rows: return
    with open(path, 'w') as f:
        f.write('\t'.join(rows[0]) + '\n')
        for r in rows: f.write('\t'.join('' if v is None else str(v) for v in r.values()) + '\n')
write(arm_rows, f'{od}/arms.tsv'); write(mem_rows, f'{od}/memory.tsv')
med = []
for key in sorted({(r['engine'], r['arm'], r['src']) for r in arm_rows}, key=lambda k: (k[0], int(k[1][1:]), k[2])):
    rs = [r for r in arm_rows if (r['engine'], r['arm'], r['src']) == key]
    m = lambda f: round(statistics.median([r[f] for r in rs if r[f] is not None]), 2) if any(r[f] is not None for r in rs) else None
    med.append({'engine': key[0], 'arm': key[1], 'src': key[2], 'runs': len(rs),
                **{f: m(f) for f in ['rps', 'p50', 'p95', 'p99', 'mean', 'queue_wait_ms_per_request', 'handler_mean_ms', 'rss_peak_mib', 'backends_peak', 'transcript_workers_peak', 'load1_start', 'load1_end']},
                'p99_range': f"{min(r['p99'] for r in rs)}-{max(r['p99'] for r in rs)}", 'errors': sum(r['errors'] or 0 for r in rs)})
mm = []
for key in sorted({(r['engine'], r['src']) for r in mem_rows}):
    rs = [r for r in mem_rows if (r['engine'], r['src']) == key]
    mm.append({'engine': key[0], 'src': key[1], 'runs': len(rs), **{f: (round(statistics.median([r[f] for r in rs if r[f] is not None]), 1) if any(r[f] is not None for r in rs) else None)
               for f in rs[0] if f not in ('run', 'src', 'engine')}})
write(med, f'{od}/medians.tsv'); write(mm, f'{od}/memory-medians.tsv')
for r in med: print('\t'.join(str(v) for v in r.values()))
print()
for r in mm: print(json.dumps(r))
