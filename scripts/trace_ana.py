# usage: python3 -I trace_ana.py <trace-run-dir> : statements per sequential chat.history call
# Inputs: trace.log (PostgreSQL log with log_min_duration_statement = 0, prefix '%m [%p] %e %u@%d ')
#         trace_marks.json (wall-clock start/end of each call).
import sys, json, re, datetime, collections

rd = sys.argv[1]
marks = json.load(open(f'{rd}/trace_marks.json'))
LINE = re.compile(r'^(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d\.\d{3}) \w+ \[(\d+)\] \S+ (\S+)@(\S+) LOG:\s+duration: [\d.]+ ms\s+(statement|execute [^:]*):\s?(.*)$')
events = []
for line in open(f'{rd}/trace.log', errors='replace'):
    m = LINE.match(line)
    if not m:
        continue
    ts = datetime.datetime.strptime(m.group(1), '%Y-%m-%d %H:%M:%S.%f').timestamp()
    events.append((ts, int(m.group(2)), m.group(6).strip()))


def kind(sql):
    s = sql.lstrip().upper()
    if s.startswith('BEGIN') and 'READ ONLY' in s:
        return 'BEGIN_RO'
    if s.startswith('BEGIN'):
        return 'BEGIN_RW'
    if s.startswith('ROLLBACK'):
        return 'ROLLBACK'
    if s.startswith('COMMIT'):
        return 'COMMIT'
    if 'SET_CONFIG' in s:
        return 'SET_CONFIG_SETUP' if s.count('SET_CONFIG') > 1 else 'SET_CONFIG_SWITCH'
    if s.startswith('SELECT 1'):
        return 'SELECT_1'
    return 'READ' if s.startswith(('SELECT', 'WITH')) else 'OTHER'


out = []
for i, mk in enumerate(marks):
    win = [e for e in events if mk['start'] <= e[0] <= mk['end']]
    kinds = collections.Counter(kind(e[2]) for e in win)
    pids = collections.Counter(e[1] for e in win)
    seq = []
    for e in win:
        k = kind(e[2])
        seq.append(k if k != 'READ' else 'R')
    out.append({'call': i, 'key': mk['key'][-36:], 'ok': mk['ok'], 'ms': round((mk['end'] - mk['start']) * 1000), 'statements': len(win),
                'kinds': dict(kinds), 'backends': len(pids), 'sequence': ' '.join(seq)})
for o in out:
    print(json.dumps(o))
tot = collections.Counter()
for o in out:
    tot.update(o['kinds'])
n = len(out)
print('per call (mean over %d calls):' % n, {k: round(v / n, 2) for k, v in sorted(tot.items())}, 'statements', round(sum(o['statements'] for o in out) / n, 2))
