# usage: python3 -I split_ana.py <trace-run-dir>... : per call, statements on backends that ran a read-only
# snapshot in the call window ("history") versus statements on other backends ("other": background work).
import collections, datetime, json, re, sys
LINE = re.compile(r'^(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d\.\d{3}) \w+ \[(\d+)\] \S+ (\S+)@(\S+) LOG:\s+duration: [\d.]+ ms\s+(statement|execute [^:]*):\s?(.*)$')
for rd in sys.argv[1:]:
    marks = json.load(open(f'{rd}/trace_marks.json')); ev = []
    text = re.sub(r'(?<!^)(?<!\n)(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d\.\d{3} \w+ \[\d+\] )', r'\n\1', open(f'{rd}/trace.log', errors='replace').read())
    for line in text.splitlines():
        m = LINE.match(line)
        if m: ev.append((datetime.datetime.strptime(m.group(1), '%Y-%m-%d %H:%M:%S.%f').timestamp(), int(m.group(2)), m.group(6).strip().upper()))
    tot = collections.Counter(); n = 0
    for mk in marks:
        win = [e for e in ev if mk['start'] <= e[0] <= mk['end']]
        hp = {p for _, p, s in win if s.startswith('BEGIN') and 'READ ONLY' in s}
        h = [s for _, p, s in win if p in hp]; o = [s for _, p, s in win if p not in hp]
        tot['history_statements'] += len(h); tot['other_statements'] += len(o)
        tot['history_begin_ro'] += sum(1 for s in h if s.startswith('BEGIN') and 'READ ONLY' in s)
        tot['ok'] += mk['ok']; n += 1
    print(rd.rsplit('/', 1)[-1], {k: round(v / n, 2) for k, v in sorted(tot.items())}, f'calls={n}')
