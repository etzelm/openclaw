# usage: python3 -I snap_ana.py [--key SUBSTR] <trace-run-dir>...
# Per chat.history call, splits each backend's read-only transactions (BEGIN .. ROLLBACK) by what they read:
#   pending = reads session_pending_inputs, page = reads transcript/projection tables, other = anything else
# (background work that happened to run in the call window, e.g. the session roster scan of session_nodes). Prints means per call.
import collections, datetime, json, re, sys
LINE = re.compile(r'^(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d\.\d{3}) \w+ \[(\d+)\] \S+ (\S+)@(\S+) LOG:\s+duration: [\d.]+ ms\s+(statement|execute [^:]*):\s?(.*)$')
args = sys.argv[1:]; key = None
if args[:1] == ['--key']: key, args = args[1], args[2:]
PAGE = ('"watermark"', '"active"', 'transcript', 'session_events', 'message_position')
for rd in args:
    marks = json.load(open(f'{rd}/trace_marks.json')); ev = []
    # Backends write the container log to stderr, so a short line can land inside another backend's long
    # DETAIL line; split at every embedded log prefix before matching.
    text = re.sub(r'(?<!^)(?<!\n)(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d\.\d{3} \w+ \[\d+\] )', r'\n\1', open(f'{rd}/trace.log', errors='replace').read())
    for line in text.splitlines():
        m = LINE.match(line)
        if m: ev.append((datetime.datetime.strptime(m.group(1), '%Y-%m-%d %H:%M:%S.%f').timestamp(), int(m.group(2)), m.group(6).strip()))
    tot = collections.Counter(); n = 0
    for mk in marks:
        if key and key not in mk['key']: continue
        n += 1; tot['ok'] += mk['ok']
        open_tx = {}
        # 100 ms margin: the database clock runs in a VM and can trail the host clock by a few ms; calls are 0.5 s apart.
        for _, pid, s in (e for e in ev if mk['start'] - 0.1 <= e[0] <= mk['end'] + 0.1):
            u = s.upper()
            if u.startswith('BEGIN') and 'READ ONLY' in u: open_tx[pid] = []; continue
            if pid in open_tx:
                if u.startswith(('ROLLBACK', 'COMMIT')):
                    reads = open_tx.pop(pid); body = ' '.join(reads)
                    kind = ('pending' if 'session_pending_inputs' in body else 'other' if '"session_nodes"' in body
                            else 'page' if any(p in body for p in PAGE) else 'other')
                    tot[f'{kind}_snapshots'] += 1; tot[f'{kind}_reads'] += len(reads)
                elif 'SET_CONFIG' not in u: open_tx[pid].append(s)
    print(rd.rsplit('/', 1)[-1] + (f' [{key}]' if key else ''), {k: round(v / n, 2) for k, v in sorted(tot.items())}, f'calls={n}')
