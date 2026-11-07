# One Gateway boot per run: fresh DB from template + fresh home copy, prometheus plugin on, warmup, then arms.
# Per arm: prom scrape before/after, closed-loop driver, loadavg. A background thread scrapes prometheus every
# 2 s (worker counts/heap, sessionTranscript queue) and pg_stat_activity backends; idle scrapes 10 s and 45 s
# after the last arm (burst workers retire after 30 s idle).
# usage: python3 -I runL3d.py <src> <engine:postgres|sqlite> <seed> <outdir> <warmupS> <arm>...
#   arm = name:opsfile:durationS:concurrency
import subprocess, sys, time, os, json, signal, re, threading, urllib.request
src, engine, seed, out, warm = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4], int(sys.argv[5])
arms = [a.split(':') for a in sys.argv[6:]]
W = os.path.expanduser('~/work/bench'); P = os.path.expanduser('~/homebrew/opt/postgresql@17/bin')
PORT = '19377'; label = os.path.basename(out.rstrip('/')); H = f'{W}/inst/{label}/home'
os.makedirs(out, exist_ok=True)
WS = f'{W}/src-{src}/node_modules/ws/index.js'; DRV = ['node', f'{W}/scripts/driver.mjs', WS, PORT]
SU = [f'{P}/psql', '-h', f'{W}/pg/run', '-p', '55977', '-U', 'openclaw', '-d', 'postgres', '-X', '-qAt', '-F', '\t']
def loadavg(): return subprocess.run(['sysctl', '-n', 'vm.loadavg'], capture_output=True, text=True).stdout.strip()
def prom():
    try: return urllib.request.urlopen(f'http://127.0.0.1:{PORT}/api/diagnostics/prometheus', timeout=30).read().decode()
    except Exception as e: return f'# scrape failed {e}\n'
def scrape(path): open(path, 'w').write(prom())
KEEP = re.compile(r'^openclaw_(worker_count|worker_heap_used_bytes|worker_heap_sampled_count|memory_bytes|worker_queue_wait_seconds_(sum|count)\{[^}]*sessionTranscript|process_)')
def backends():
    if engine != 'postgres': return ''
    r = subprocess.run(SU + ['-c', "select count(*), count(*) filter (where state='active') from pg_stat_activity where usename='openclaw_runtime'"], capture_output=True, text=True)
    return r.stdout.strip()
if subprocess.run(['lsof', '-nP', f'-iTCP:{PORT}', '-sTCP:LISTEN'], capture_output=True, text=True).stdout.strip():
    json.dump({'label': label, 'error': f'port {PORT} busy before start'}, open(f'{out}/run.json', 'w')); sys.exit(2)
r = subprocess.run(['sh', f'{W}/scripts/arm_reset.sh', engine, seed, label], capture_output=True, text=True)
open(f'{out}/reset.log', 'w').write(r.stdout + r.stderr)
cfgp = f'{H}/.openclaw/openclaw.json'; c = json.load(open(cfgp))
c['plugins']['allow'].append('diagnostics-prometheus'); c['plugins']['entries']['diagnostics-prometheus'] = {'enabled': True}
c['diagnostics'] = {'enabled': True}; json.dump(c, open(cfgp, 'w'), indent=1)
env = {k: v for k, v in os.environ.items() if not k.endswith('_API_KEY')}
GWCMD = [f'{W}/scripts/oc.sh', src, H, 'gateway', 'run', '--port', PORT, '--bind', 'loopback', '--auth', 'none', '--tailscale', 'off']
# Priming boot: the first boot on a freshly copied home + template DB exits with
# "PostgreSQL connections must run in a worker"; the next boot is clean.
if engine == 'postgres':
    pg_ = subprocess.Popen(GWCMD, stdout=open(f'{out}/gateway.prime.log', 'w'), stderr=subprocess.STDOUT, start_new_session=True, env=env)
    try: pg_.wait(90)
    except subprocess.TimeoutExpired:
        os.killpg(pg_.pid, signal.SIGTERM)
        try: pg_.wait(60)
        except subprocess.TimeoutExpired: os.killpg(pg_.pid, signal.SIGKILL); pg_.wait()
log = open(f'{out}/gateway.log', 'w'); t0 = time.monotonic()
gw = subprocess.Popen(GWCMD, stdout=log, stderr=subprocess.STDOUT, start_new_session=True, env=env)
gwStartEpoch = time.time()
smp = subprocess.Popen(['python3', '-I', f'{W}/scripts/sample.py', str(gw.pid), '0', '2', f'{out}/samples.csv', f'{out}/stop'])
stop = threading.Event()
def poller():
    with open(f'{out}/timeline.txt', 'w') as f:
        while not stop.is_set():
            t = time.time(); body = prom(); b = backends()
            f.write(f'@ {t:.1f} backends={b} load={loadavg()}\n')
            f.writelines(l + '\n' for l in body.splitlines() if KEEP.match(l))
            f.flush(); stop.wait(2)
ready = rpc = None
while time.monotonic() - t0 < 600 and gw.poll() is None:
    if ready is None and re.search(r'\[gateway\] ready(\s*\(|\s*$)', open(f'{out}/gateway.log').read(), re.M): ready = time.monotonic() - t0
    if ready is not None:
        rr = subprocess.run(DRV + ['call', 'sessions.list', '{"limit":1}', '200'], capture_output=True, text=True)
        if '"ok":true' in rr.stdout: rpc = time.monotonic() - t0; break
    time.sleep(0.2)
res = {'gwStartEpoch': gwStartEpoch, 'src': src, 'engine': engine, 'seed': seed, 'label': label, 'readyS': ready and round(ready, 2), 'firstRpcS': rpc and round(rpc, 2),
       'loadavgStart': loadavg(), 'memStart': subprocess.run(['memory_pressure', '-Q'], capture_output=True, text=True).stdout.strip().splitlines()[-1:], 'arms': []}
print('started', res, flush=True)
th = threading.Thread(target=poller, daemon=True); th.start()
if rpc is not None:
    time.sleep(5); scrape(f'{out}/idle0.prom'); res['backendsIdle0'] = backends()
    if warm > 0:
        subprocess.run(DRV + ['load', str(warm), '4', f'{out}/warmup.json', f'{W}/scripts/{arms[0][1]}'], capture_output=True, text=True)
    for name, ops, dur, conc in arms:
        time.sleep(3)
        scrape(f'{out}/{name}.prom.before'); la0 = loadavg(); ts = time.time()
        rr = subprocess.run(DRV + ['load', dur, conc, f'{out}/{name}.json', f'{W}/scripts/{ops}'], capture_output=True, text=True)
        te = time.time(); la1 = loadavg(); scrape(f'{out}/{name}.prom.after')
        if rr.stderr: open(f'{out}/{name}.driver.err', 'w').write(rr.stderr)
        d = json.load(open(f'{out}/{name}.json')) if os.path.exists(f'{out}/{name}.json') else {}
        arm = {'name': name, 'ops': ops, 'conc': int(conc), 'start': ts, 'end': te, 'loadavg': [la0, la1], 'rps': d.get('rps'),
               'perOp': {k: v for k, v in d.get('perOp', {}).items() if v.get('n')}}
        res['arms'].append(arm); print('arm', name, json.dumps(arm['perOp'])[:400], la1, flush=True)
    time.sleep(10); scrape(f'{out}/idle10.prom'); res['backendsIdle10'] = backends()
    time.sleep(35); scrape(f'{out}/idle45.prom'); res['backendsIdle45'] = backends()
    # A recently recreated burst worker can stay warm for three times the 30 s surplus timeout.
    time.sleep(55); scrape(f'{out}/idle100.prom'); res['backendsIdle100'] = backends()
    if os.environ.get('L3D_IDLE300'):
        time.sleep(200); scrape(f'{out}/idle300.prom'); res['backendsIdle300'] = backends()
else:
    res['error'] = f'gateway not ready rc={gw.poll()}'
stop.set(); th.join(10)
open(f'{out}/stop', 'w').close()
try:
    os.killpg(gw.pid, signal.SIGTERM)
    try: gw.wait(60)
    except subprocess.TimeoutExpired: os.killpg(gw.pid, signal.SIGKILL); gw.wait()
except ProcessLookupError: pass
smp.wait(10); res['gatewayExit'] = gw.returncode

json.dump(res, open(f'{out}/run.json', 'w'), indent=1)
print('DONE', label, flush=True)
