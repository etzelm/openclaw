# usage: python3 -I rtt.py : round trip of `SELECT 1` through the toxiproxy port (what the Gateway uses), 200 samples
# over one connection, using the psql client and \timing. Prints median and p95 in ms.
import os, re, statistics, subprocess
W = os.path.expanduser('~/work/pc-190001'); P = os.path.expanduser('~/homebrew/opt/postgresql@17/bin/psql')
pw = open(f'{W}/.pw').read().strip()
script = '\\timing on\n' + 'SELECT 1;\n' * 200
r = subprocess.run([P, '-h', '127.0.0.1', '-p', '55991', '-U', 'openclaw', '-d', 'postgres', '-X', '-q'], input=script,
                   capture_output=True, text=True, env=dict(os.environ, PGPASSWORD=pw))
v = sorted(float(x) for x in re.findall(r'Time: ([\d.]+) ms', r.stdout))
print(r.stderr[-300:]) if not v else None
print(f'rtt samples={len(v)} median={statistics.median(v):.3f} ms p95={v[int(len(v) * 0.95)]:.3f} ms')
