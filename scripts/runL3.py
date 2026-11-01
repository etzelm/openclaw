# One gateway boot per round: fresh DB from template + fresh home (arm_reset.sh), prometheus plugin on,
# warmup, then arms. Per arm: pgss reset, prom scrape before/after, driver load, pgss dump, loadavg.
# usage: python3 -I runL3.py <src> <outdir> <warmupS> <arm>...   arm = name:opsfile:durationS:concurrency
import subprocess, sys, time, os, json, signal, re, urllib.request
src, out, warm = sys.argv[1], sys.argv[2], int(sys.argv[3]); arms = [a.split(':') for a in sys.argv[4:]]
W = os.path.expanduser('~/work/pg-r2-l3c'); P = os.path.expanduser('~/homebrew/opt/postgresql@17/bin')
PORT = '19361'; label = os.path.basename(out.rstrip('/')); H = f'{W}/inst/{label}/home'
os.makedirs(out, exist_ok=True)
WS = f'{W}/src-{src}/node_modules/ws/index.js'; DRV = ['node', f'{W}/scripts/driver.mjs', WS, PORT]
PSQL = [f'{P}/psql', '-h', f'{W}/pg/run', '-p', '55936', '-U', 'openclaw', '-d', 'openclaw', '-X', '-qAt', '-F', '\t']
def loadavg(): return subprocess.run(['sysctl', '-n', 'vm.loadavg'], capture_output=True, text=True).stdout.strip()
def psql(q): return subprocess.run(PSQL + ['-c', q], capture_output=True, text=True).stdout
def scrape(path):
    try: open(path, 'w').write(urllib.request.urlopen(f'http://127.0.0.1:{PORT}/api/diagnostics/prometheus', timeout=30).read().decode())
    except Exception as e: open(path, 'w').write(f'# scrape failed {e}\n')
PGSS = ("select queryid, calls, round(total_exec_time::numeric,3), round(mean_exec_time::numeric,3), round(max_exec_time::numeric,3), "
        "round(stddev_exec_time::numeric,3), round(total_plan_time::numeric,3), rows, shared_blks_hit, shared_blks_read, "
        "regexp_replace(left(query, 300), '\\s+', ' ', 'g') from pg_stat_statements where dbid = (select oid from pg_database where datname='openclaw') order by total_exec_time desc")
r = subprocess.run(['sh', f'{W}/scripts/arm_reset.sh', 'seed_a', label, src], capture_output=True, text=True)
open(f'{out}/reset.log', 'w').write(r.stdout + r.stderr)
cfgp = f'{H}/.openclaw/openclaw.json'; c = json.load(open(cfgp))
c['plugins']['allow'].append('diagnostics-prometheus'); c['plugins']['entries']['diagnostics-prometheus'] = {'enabled': True}
c['diagnostics'] = {'enabled': True}; json.dump(c, open(cfgp, 'w'), indent=1)
env = {k: v for k, v in os.environ.items() if not k.endswith('_API_KEY')}
if os.environ.get('L3_PROF'): env['L3_NODE_OPTIONS'] = f'--cpu-prof --cpu-prof-dir={out}/cpuprof --cpu-prof-interval=500'
log = open(f'{out}/gateway.log', 'w'); t0 = time.monotonic()
gw = subprocess.Popen([f'{W}/scripts/oc.sh', src, H, 'gateway', 'run', '--port', PORT, '--bind', 'loopback', '--auth', 'none', '--tailscale', 'off'],
                      stdout=log, stderr=subprocess.STDOUT, start_new_session=True, env=env)
smp = subprocess.Popen(['python3', '-I', f'{W}/scripts/sample.py', str(gw.pid), '0', '2', f'{out}/samples.csv', f'{out}/stop'])
ready = rpc = None
while time.monotonic() - t0 < 600 and gw.poll() is None:
    if ready is None and re.search(r'\[gateway\] ready(\s*\(|\s*$)', open(f'{out}/gateway.log').read(), re.M): ready = time.monotonic() - t0
    if ready is not None:
        rr = subprocess.run(DRV + ['call', 'sessions.list', '{"limit":1}', '200'], capture_output=True, text=True)
        if '"ok":true' in rr.stdout: rpc = time.monotonic() - t0; break
    time.sleep(0.2)
res = {'src': src, 'label': label, 'readyS': ready and round(ready, 2), 'firstRpcS': rpc and round(rpc, 2), 'loadavgStart': loadavg(), 'arms': []}
print('started', res, flush=True)
if rpc is not None:
    if warm > 0:
        subprocess.run(DRV + ['load', str(warm), '8', f'{out}/warmup.json', f"{W}/scripts/{os.environ.get('L3C_WARM_OPS', 'ops.json')}"], capture_output=True, text=True)
    if os.environ.get('L3C_TRACE'):
        # L3c: every statement (with backend pid) for a few sequential chat.history calls
        PGLOG = f'{W}/pg/log/postgresql.log'
        su = PSQL[:7] + ['-d', 'postgres', '-X', '-qAt']
        keys = json.load(open(f'{W}/scripts/ops_hist.json'))[0]['params'][:int(os.environ['L3C_TRACE'])]
        for p in keys: subprocess.run(DRV + ['call', 'chat.history', json.dumps(p), '100000000'], capture_output=True, text=True)
        subprocess.run(su + ['-c', 'alter system set log_min_duration_statement = 0', '-c', 'select pg_reload_conf()'], capture_output=True); time.sleep(1)
        pos = os.path.getsize(PGLOG); marks = []
        for p in keys:
            for _ in range(2):
                t1 = time.time(); rr = subprocess.run(DRV + ['call', 'chat.history', json.dumps(p), '100000000'], capture_output=True, text=True)
                marks.append({'key': p['sessionKey'], 'start': t1, 'end': time.time(), 'ok': '"ok":true' in rr.stdout}); time.sleep(0.5)
        subprocess.run(su + ['-c', 'alter system reset log_min_duration_statement', '-c', 'select pg_reload_conf()'], capture_output=True); time.sleep(1)
        with open(PGLOG, 'rb') as f: f.seek(pos); open(f'{out}/trace.log', 'wb').write(f.read())
        json.dump(marks, open(f'{out}/trace_marks.json', 'w'), indent=1)
    if os.environ.get('L3_CAPTURE'):
        # exact search SQL + params from the server log, and the full responses for the 12 terms
        PGLOG = f'{W}/pg/log/postgresql.log'
        su = PSQL[:7] + ['-d', 'postgres', '-X', '-qAt']
        subprocess.run(su + ['-c', 'alter system set log_min_duration_statement = 0', '-c', 'select pg_reload_conf()'], capture_output=True); time.sleep(1)
        pos = os.path.getsize(PGLOG); resp = {}
        for p in json.load(open(f'{W}/scripts/ops_search.json'))[0]['params']:
            rr = subprocess.run(DRV + ['call', 'sessions.search', json.dumps(p), '100000000'], capture_output=True, text=True)
            resp[p['query']] = json.loads(rr.stdout).get('payload')
        subprocess.run(su + ['-c', 'alter system reset log_min_duration_statement', '-c', 'select pg_reload_conf()'], capture_output=True); time.sleep(1)
        with open(PGLOG, 'rb') as f: f.seek(pos); open(f'{out}/capture.log', 'wb').write(f.read())
        json.dump(resp, open(f'{out}/search_responses.json', 'w'), indent=1, sort_keys=True)
    if os.environ.get('L3_SLOWLOG'):
        su = PSQL[:7] + ['-d', 'postgres', '-X', '-qAt']; PGLOG = f'{W}/pg/log/postgresql.log'
        subprocess.run(su + ['-c', f"alter system set log_min_duration_statement = {os.environ['L3_SLOWLOG']}", '-c', 'select pg_reload_conf()'], capture_output=True); slowpos = os.path.getsize(PGLOG)
    for name, ops, dur, conc in arms:
        psql('select pg_stat_statements_reset()')
        scrape(f'{out}/{name}.prom.before'); la0 = loadavg(); ts = time.time()
        rr = subprocess.run(DRV + ['load', dur, conc, f'{out}/{name}.json', f'{W}/scripts/{ops}'], capture_output=True, text=True)
        te = time.time(); la1 = loadavg(); scrape(f'{out}/{name}.prom.after')
        open(f'{out}/{name}.pgss.tsv', 'w').write(psql(PGSS))
        if rr.stderr: open(f'{out}/{name}.driver.err', 'w').write(rr.stderr)
        d = json.load(open(f'{out}/{name}.json')) if os.path.exists(f'{out}/{name}.json') else {}
        arm = {'name': name, 'ops': ops, 'conc': int(conc), 'start': ts, 'end': te, 'loadavg': [la0, la1], 'rps': d.get('rps'),
               'perOp': {k: v for k, v in d.get('perOp', {}).items() if v.get('n')}}
        res['arms'].append(arm); print('arm', name, json.dumps(arm['perOp'])[:600], la1, flush=True)
    if os.environ.get('L3_SLOWLOG'):
        subprocess.run(su + ['-c', 'alter system reset log_min_duration_statement', '-c', 'select pg_reload_conf()'], capture_output=True)
        with open(PGLOG, 'rb') as f: f.seek(slowpos); open(f'{out}/slow.log', 'wb').write(f.read())
else:
    res['error'] = f'gateway not ready rc={gw.poll()}'
open(f'{out}/stop', 'w').close()
try:
    os.killpg(gw.pid, signal.SIGTERM)
    try: gw.wait(60)
    except subprocess.TimeoutExpired: os.killpg(gw.pid, signal.SIGKILL); gw.wait()
except ProcessLookupError: pass
smp.wait(10); res['gatewayExit'] = gw.returncode
json.dump(res, open(f'{out}/run.json', 'w'), indent=1)
print('DONE', label, flush=True)
