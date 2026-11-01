# Import the plan's Claude CLI sessions on top of an existing seed, then snapshot as a new seed.
# usage: python3 -I claude_pass.py <src> <engine> <fromSeed> <toSeed>
import subprocess, sys, time, os, json, signal, shutil
src, engine, frm, to = sys.argv[1:5]
W = os.path.expanduser('~/work/pg-r2-l3d'); P = os.path.expanduser('~/homebrew/opt/postgresql@17/bin')
PORT = '19362'; label = f'claude-{to}'; H = f'{W}/inst/{label}/home'; LOG = f'{W}/logs/seed-{to}'
os.makedirs(LOG, exist_ok=True)
SU = [f'{P}/psql', '-h', f'{W}/pg/run', '-p', '55937', '-U', 'openclaw', '-d', 'postgres', '-X', '-q', '-v', 'ON_ERROR_STOP=1']
WS = f'{W}/src-{src}/node_modules/ws/index.js'; DRV = ['node', f'{W}/scripts/driver.mjs', WS, PORT]
print(subprocess.run(['sh', f'{W}/scripts/arm_reset.sh', engine, frm, label], capture_output=True, text=True).stdout.strip())
shutil.rmtree(f'{H}/.claude', ignore_errors=True)
print(subprocess.run(['python3', '-I', f'{W}/scripts/mkplan.py', H, f'{LOG}/plan-full.json'], capture_output=True, text=True).stdout.strip())
plan = json.load(open(f'{LOG}/plan-full.json')); plan['inject'] = []
json.dump(plan, open(f'{LOG}/plan.json', 'w'))
def stop(gw):
    try:
        os.killpg(gw.pid, signal.SIGTERM)
        try: gw.wait(60)
        except subprocess.TimeoutExpired: os.killpg(gw.pid, signal.SIGKILL); gw.wait()
    except ProcessLookupError: pass
def boot(n):
    log = open(f'{LOG}/gateway{n}.log', 'w'); t0 = time.monotonic()
    gw = subprocess.Popen([f'{W}/scripts/oc.sh', src, H, 'gateway', 'run', '--port', PORT, '--bind', 'loopback', '--auth', 'none', '--tailscale', 'off'],
                          stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
    while time.monotonic() - t0 < 600 and gw.poll() is None:
        if '"ok":true' in subprocess.run(DRV + ['call', 'sessions.list', '{"limit":1}', '200'], capture_output=True, text=True).stdout: return gw
        time.sleep(1)
    stop(gw); return None
gw = boot(1) or boot(2)
if not gw: print('boot failed'); sys.exit(1)
r = subprocess.run(['node', f'{W}/scripts/seed.mjs', WS, PORT, f'{LOG}/plan.json', f'{LOG}/ops_claude.json'], capture_output=True, text=True)
open(f'{LOG}/seed.out', 'w').write(r.stdout + r.stderr); print(r.stdout[-500:], r.stderr[-1200:], 'rc', r.returncode, flush=True)
stop(gw)
if r.returncode: sys.exit(1)
gw = boot(3)
if gw: time.sleep(20); stop(gw)
if engine == 'postgres':
    subprocess.run(SU + ['-c', f'DROP DATABASE IF EXISTS {to}', '-c', f'CREATE DATABASE {to} TEMPLATE openclaw'], check=True)
shutil.rmtree(f'{W}/seed/home-{to}', ignore_errors=True)
subprocess.run(['cp', '-Rc', H, f'{W}/seed/home-{to}'], check=True)
base = json.load(open(f'{W}/scripts/ops_{frm}.json')); extra = json.load(open(f'{LOG}/ops_claude.json'))
base[0]['params'] += extra[0]['params']
json.dump(base, open(f'{W}/scripts/ops_{to}.json', 'w'))
print('CLAUDE_PASS_DONE', to, len(base[0]['params']), 'sessions', flush=True)
