# Build one synthetic seed with the base build: fresh home + (postgres) fresh openclaw DB, boot, seed.mjs, stop,
# then snapshot as template DB <seed> + seed/home-<seed>.
# usage: python3 -I seed_run.py <src> <engine:postgres|sqlite> <seed>
import subprocess, sys, time, os, json, signal, re, shutil
src, engine, seed = sys.argv[1:4]
W = os.path.expanduser('~/work/bench'); P = os.path.expanduser('~/homebrew/opt/postgresql@17/bin')
PORT = '19377'; H = f'{W}/seed/build-{seed}/home'; LOG = f'{W}/logs/seed-{seed}'
os.makedirs(LOG, exist_ok=True)
SU = [f'{P}/psql', '-h', f'{W}/pg/run', '-p', '55977', '-U', 'openclaw', '-d', 'postgres', '-X', '-q', '-v', 'ON_ERROR_STOP=1']
WS = f'{W}/src-{src}/node_modules/ws/index.js'; DRV = ['node', f'{W}/scripts/driver.mjs', WS, PORT]
shutil.rmtree(f'{W}/seed/build-{seed}', ignore_errors=True); os.makedirs(H)
print(subprocess.run(['python3', '-I', f'{W}/scripts/mkconfig.py', H, PORT, engine], capture_output=True, text=True).stdout.strip())
cfgp = f'{H}/.openclaw/openclaw.json'; c = json.load(open(cfgp))
c['plugins']['allow'].append('anthropic'); c['plugins']['entries']['anthropic'] = {'enabled': True}
json.dump(c, open(cfgp, 'w'), indent=1)
for a in c['agents']['entries'].values(): os.makedirs(a['workspace'], exist_ok=True)
print(subprocess.run(['python3', '-I', f'{W}/scripts/mkplan.py', H, f'{LOG}/plan.json'], capture_output=True, text=True).stdout.strip(), flush=True)
if engine == 'postgres':
    subprocess.run(SU + ['-c', 'DROP DATABASE IF EXISTS openclaw WITH (FORCE)', '-c', f'DROP DATABASE IF EXISTS {seed}',
                         '-c', "CREATE DATABASE openclaw ENCODING 'UTF8' TEMPLATE template0", '-c', 'REVOKE ALL ON DATABASE openclaw FROM PUBLIC',
                         '-c', 'GRANT CONNECT, CREATE, TEMPORARY ON DATABASE openclaw TO openclaw_runtime'], check=True)
    subprocess.run([f'{P}/psql', '-h', f'{W}/pg/run', '-p', '55977', '-U', 'openclaw', '-d', 'openclaw', '-X', '-q', '-v', 'ON_ERROR_STOP=1',
                    '-c', 'CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA public', '-c', 'CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public',
                    '-c', 'CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public', '-c', 'CREATE EXTENSION IF NOT EXISTS pg_stat_statements WITH SCHEMA public',
                    '-c', 'GRANT USAGE ON SCHEMA public TO openclaw_runtime'], check=True)
def boot(n):
    log = open(f'{LOG}/gateway{n}.log', 'w'); t0 = time.monotonic()
    gw = subprocess.Popen([f'{W}/scripts/oc.sh', src, H, 'gateway', 'run', '--port', PORT, '--bind', 'loopback', '--auth', 'none', '--tailscale', 'off'],
                          stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
    while time.monotonic() - t0 < 600 and gw.poll() is None:
        rr = subprocess.run(DRV + ['call', 'sessions.list', '{"limit":1}', '200'], capture_output=True, text=True)
        if '"ok":true' in rr.stdout: return gw
        time.sleep(1)
    print(f'boot {n} failed rc={gw.poll()}', flush=True)
    stop(gw); return None
def stop(gw):
    try:
        os.killpg(gw.pid, signal.SIGTERM)
        try: gw.wait(60)
        except subprocess.TimeoutExpired: os.killpg(gw.pid, signal.SIGKILL); gw.wait()
    except ProcessLookupError: pass
gw = boot(1) or boot(2)
if not gw: sys.exit(1)
t0 = time.time()
r = subprocess.run(['node', f'{W}/scripts/seed.mjs', WS, PORT, f'{LOG}/plan.json', f'{W}/scripts/ops_{seed}.json'], capture_output=True, text=True)
open(f'{LOG}/seed.out', 'w').write(r.stdout + r.stderr)
print(r.stdout[-600:], r.stderr[-1500:], f'seed rc={r.returncode} {time.time()-t0:.0f} s', flush=True)
stop(gw)
if r.returncode: sys.exit(1)
# Boot once more on the seeded state so startup work (indexes, catalog) settles before the snapshot.
gw = boot(3)
if gw: time.sleep(20); stop(gw)
if engine == 'postgres':
    subprocess.run(SU + ['-c', f'CREATE DATABASE {seed} TEMPLATE openclaw'], check=True)
shutil.rmtree(f'{W}/seed/home-{seed}', ignore_errors=True)
subprocess.run(['cp', '-Rc', H, f'{W}/seed/home-{seed}'], check=True)
print('SEED_SNAPSHOT_DONE', seed, flush=True)
