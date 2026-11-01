# usage: python3 -I ana_l3c.py <results-dir> : per run/arm table for the L3c chat.history arms
# Sources per arm: <arm>.json (driver latencies), <arm>.pgss.tsv (pg_stat_statements, reset per arm),
# <arm>.prom.before/.after (Prometheus scrape), run.json (load average per arm).
import sys, os, json, re, glob, statistics

LINE = re.compile(r'^([a-zA-Z_:][a-zA-Z0-9_:]*)(\{[^}]*\})?\s+(\S+)')


def prom(path):
    d = {}
    for line in open(path):
        if line.startswith('#'):
            continue
        m = LINE.match(line)
        if m:
            try:
                d[(m.group(1), m.group(2) or '')] = float(m.group(3))
            except ValueError:
                pass
    return d


def labels(s):
    return dict(re.findall(r'(\w+)="((?:[^"\\]|\\.)*)"', s))


def delta(before, after, name, want):
    total = 0.0
    for (n, ls), v in after.items():
        if n != name:
            continue
        L = labels(ls)
        if all(L.get(k) == x for k, x in want.items()):
            total += v - before.get((n, ls), 0.0)
    return total


def pgss(path):
    rows = [l.rstrip('\n').split('\t') for l in open(path) if l.strip()]
    out = {'all': 0, 'begin_ro': 0, 'rollback': 0, 'set_config_switch': 0, 'set_config_setup': 0, 'exec_ms': 0.0, 'plan_ms': 0.0}
    for r in rows:
        calls, q = int(r[1]), r[10]
        out['all'] += calls
        out['exec_ms'] += float(r[2])
        out['plan_ms'] += float(r[6])
        if re.match(r'\s*BEGIN\b.*READ ONLY', q, re.I):
            out['begin_ro'] += calls
        elif re.match(r'\s*ROLLBACK\b', q, re.I):
            out['rollback'] += calls
        elif 'set_config' in q:
            out['set_config_setup' if q.count('set_config') > 1 else 'set_config_switch'] += calls
    return out


def arm_row(rd, run, arm):
    n = arm['name']
    d = json.load(open(f'{rd}/{n}.json'))
    h = d['perOp'].get('chat.history', {})
    calls = h.get('n') or 0
    errs = h.get('errors') or 0
    p = pgss(f'{rd}/{n}.pgss.tsv')
    b, a = prom(f'{rd}/{n}.prom.before'), prom(f'{rd}/{n}.prom.after')
    want = {'kind': 'sessionTranscript'}
    qn = delta(b, a, 'openclaw_worker_queue_wait_seconds_count', want)
    qs = delta(b, a, 'openclaw_worker_queue_wait_seconds_sum', want)
    hn = delta(b, a, 'openclaw_gateway_rpc_handler_seconds_count', {'method': 'chat.history'})
    hs = delta(b, a, 'openclaw_gateway_rpc_handler_seconds_sum', {'method': 'chat.history'})
    per = lambda x: round(x / calls, 2) if calls else None
    return {
        'run': run['label'], 'src': run['src'], 'arm': n, 'conc': arm['conc'],
        'load1_start': float(arm['loadavg'][0].strip('{} ').split()[0]),
        'load1_end': float(arm['loadavg'][1].strip('{} ').split()[0]),
        'calls': calls, 'rps': d.get('rps'), 'errors': errs,
        'p50': h.get('p50'), 'p95': h.get('p95'), 'p99': h.get('p99'), 'mean': h.get('mean'),
        'stmts_per_call': per(p['all']), 'begin_ro_per_call': per(p['begin_ro']),
        'rollback_per_call': per(p['rollback']), 'set_config_switch_per_call': per(p['set_config_switch']),
        'set_config_setup_per_call': per(p['set_config_setup']),
        'sql_exec_plus_plan_ms_per_call': per(p['exec_ms'] + p['plan_ms']),
        'worker_requests_per_call': per(qn),
        'queue_wait_ms_per_request': round(qs / qn * 1000, 2) if qn else None,
        'handler_mean_ms': round(hs / hn * 1000, 2) if hn else None,
    }


def main():
    root = sys.argv[1]
    rows = []
    for rd in sorted(d for d in glob.glob(f'{root}/*-r[0-9]') if os.path.exists(f'{d}/run.json')):
        run = json.load(open(f'{rd}/run.json'))
        for arm in run['arms']:
            rows.append(arm_row(rd, run, arm))
    cols = list(rows[0].keys())
    with open(f'{root}/table.tsv', 'w') as f:
        f.write('\t'.join(cols) + '\n')
        for r in rows:
            f.write('\t'.join(str(r[c]) for c in cols) + '\n')
    keys = ['p50', 'p95', 'p99', 'stmts_per_call', 'begin_ro_per_call', 'rollback_per_call',
            'set_config_switch_per_call', 'worker_requests_per_call', 'queue_wait_ms_per_request', 'handler_mean_ms']
    med = {}
    for r in rows:
        med.setdefault((r['arm'], r['src']), []).append(r)
    with open(f'{root}/medians.tsv', 'w') as f:
        f.write('arm\tsrc\truns\t' + '\t'.join(keys) + '\tload1_range\n')
        for (arm, src), rs in sorted(med.items()):
            vals = [statistics.median([x[k] for x in rs if x[k] is not None]) if any(x[k] is not None for x in rs) else None for k in keys]
            loads = [x['load1_start'] for x in rs] + [x['load1_end'] for x in rs]
            f.write(f"{arm}\t{src}\t{len(rs)}\t" + '\t'.join(str(round(v, 2)) if v is not None else '' for v in vals) + f"\t{min(loads):.1f}-{max(loads):.1f}\n")
    print(open(f'{root}/medians.tsv').read())


if __name__ == '__main__':
    main()
