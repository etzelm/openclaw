# P190001 live Gateway chat.history statement trace on current source (dockerized PostgreSQL 17).
# usage: python3 -I run.py seed            -> seed with the base build, snapshot as template DB seed_t + seed/home
#        python3 -I run.py trace <arm> <tag> -> fresh DB + home from the seed, boot <arm> (base|fix), warm, trace
import json, os, shutil, signal, subprocess, sys, time
W = os.path.expanduser('~/work/pc-190001'); PORT = '19390'
DK = ['docker', '--context', 'colima-openclaw']
def sql(*cmds, db='postgres'):
    a = DK + ['exec', '-i', 'pc190001-pg', 'psql', '-U', 'openclaw', '-d', db, '-X', '-qAt', '-v', 'ON_ERROR_STOP=1']
    for c in cmds: a += ['-c', c]
    return subprocess.run(a, check=True, capture_output=True, text=True).stdout
def drv(src, *args, scopes=None):
    env = dict(os.environ, DRV_SCOPES=scopes) if scopes else None
    return subprocess.run(['node', f'{W}/scripts/driver.mjs', f'{W}/src-{src}/node_modules/ws/index.js', PORT, *args], capture_output=True, text=True, env=env)
def boot(src, home, log):
    if '"ok":true' in drv(src, 'call', 'sessions.list', '{"limit":1}', '200').stdout: sys.exit('port busy: a Gateway already answers')
    for n in (1, 2):  # first boot on a fresh home + template DB may be the known priming exit
        lf = open(f'{log}-boot{n}.log', 'w'); t0 = time.monotonic()
        gw = subprocess.Popen([f'{W}/scripts/oc.sh', src, home, 'gateway', 'run', '--port', PORT, '--bind', 'loopback', '--auth', 'none', '--tailscale', 'off'],
                              stdout=lf, stderr=subprocess.STDOUT, start_new_session=True)
        while time.monotonic() - t0 < 600 and gw.poll() is None:
            if '"ok":true' in drv(src, 'call', 'sessions.list', '{"limit":1}', '200').stdout: return gw
            time.sleep(1)
        print(f'boot {n} rc={gw.poll()}', flush=True); stop(gw)
    sys.exit(f'boot failed: {log}')
def stop(gw):
    try:
        os.killpg(gw.pid, signal.SIGTERM)
        try: gw.wait(60)
        except subprocess.TimeoutExpired: os.killpg(gw.pid, signal.SIGKILL); gw.wait()
    except ProcessLookupError: pass
def fresh_db(template):
    sql('DROP DATABASE IF EXISTS openclaw WITH (FORCE)', f"CREATE DATABASE openclaw ENCODING 'UTF8' TEMPLATE {template}",
        'REVOKE ALL ON DATABASE openclaw FROM PUBLIC', 'GRANT CONNECT, CREATE, TEMPORARY ON DATABASE openclaw TO openclaw_runtime')

mode = sys.argv[1]
os.makedirs(f'{W}/logs', exist_ok=True)
if mode == 'seed':
    H = f'{W}/seed/build/home'; shutil.rmtree(f'{W}/seed', ignore_errors=True); os.makedirs(H)
    subprocess.run(['python3', '-I', f'{W}/scripts/mkconfig.py', H, PORT, 'postgres'], check=True)
    cfgp = f'{H}/.openclaw/openclaw.json'; c = json.load(open(cfgp))
    c['plugins']['allow'].append('anthropic'); c['plugins']['entries']['anthropic'] = {'enabled': True}
    json.dump(c, open(cfgp, 'w'), indent=1)
    for a in c['agents']['entries'].values(): os.makedirs(a['workspace'], exist_ok=True)
    print(subprocess.run(['python3', '-I', f'{W}/scripts/mkplan_small.py', H, f'{W}/logs/plan.json'], capture_output=True, text=True).stdout.strip(), flush=True)
    sql('DROP DATABASE IF EXISTS seed_t', 'DROP DATABASE IF EXISTS openclaw WITH (FORCE)', "CREATE DATABASE openclaw ENCODING 'UTF8' TEMPLATE template0",
        'REVOKE ALL ON DATABASE openclaw FROM PUBLIC', 'GRANT CONNECT, CREATE, TEMPORARY ON DATABASE openclaw TO openclaw_runtime')
    sql('CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA public', 'CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public',
        'CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public', 'CREATE EXTENSION IF NOT EXISTS pg_stat_statements WITH SCHEMA public',
        'GRANT USAGE ON SCHEMA public TO openclaw_runtime', db='openclaw')
    gw = boot('base', H, f'{W}/logs/seed')
    r = subprocess.run(['node', f'{W}/scripts/seed.mjs', f'{W}/src-base/node_modules/ws/index.js', PORT, f'{W}/logs/plan.json', f'{W}/scripts/ops_trace.json'],
                       capture_output=True, text=True)
    open(f'{W}/logs/seed.out', 'w').write(r.stdout + r.stderr); print(r.stdout[-400:], r.stderr[-800:], 'seed rc', r.returncode, flush=True)
    stop(gw)
    if r.returncode: sys.exit(1)
    sql('CREATE DATABASE seed_t TEMPLATE openclaw')
    subprocess.run(['cp', '-Rc', H, f'{W}/seed/home'], check=True)
    print('SEED_DONE', flush=True)
elif mode == 'sparse-seed':
    # On top of seed_t: one injected sparse session (visible, 250 silent NO_REPLY replies, visible) and one
    # Claude CLI import switched to another provider; then snapshot as seed_s + seed/home-s.
    H = f'{W}/seed/build-s/home'; shutil.rmtree(f'{W}/seed/build-s', ignore_errors=True); os.makedirs(f'{W}/seed/build-s')
    subprocess.run(['cp', '-Rc', f'{W}/seed/home', H], check=True); fresh_db('seed_t')
    CLI = 'claude-cli/claude-opus-5'
    cfgp = f'{H}/.openclaw/openclaw.json'; c = json.load(open(cfgp))
    c.setdefault('agents', {}).setdefault('defaults', {}).setdefault('models', {})[CLI] = {}
    json.dump(c, open(cfgp, 'w'), indent=1)
    gw = boot('base', H, f'{W}/logs/sparse-seed')
    key = 'agent:main:trace-sparse-252'
    ADM = 'operator.read,operator.write,operator.admin'
    for _ in range(240):  # sidecars answer retryable UNAVAILABLE during startup
        r = drv('base', 'call', 'sessions.create', json.dumps({'key': key, 'agentId': 'main'}), '400', scopes=ADM)
        if '"retryable":true' not in r.stdout: break
        time.sleep(1)
    print('create', r.stdout[:200], flush=True)
    for i in range(252):
        msg = 'Visible answer before silent activity' if i == 0 else ('Visible final answer' if i == 251 else 'NO_REPLY')
        r = drv('base', 'call', 'chat.inject', json.dumps({'sessionKey': key, 'message': msg}), '300', scopes=ADM)
        if '"ok":true' not in r.stdout: print('inject fail', i, r.stdout[:300], r.stderr[:300], flush=True); break
    # Claude CLI-bound session: one turn through the stub `claude` (creates the binding), 250 silent replies and a
    # visible one, then a provider switch away from claude-cli.
    key2 = 'agent:main:trace-cli-252'
    r = drv('base', 'call', 'sessions.create', json.dumps({'key': key2, 'agentId': 'main'}), '300', scopes=ADM); print('create cli', r.stdout[:160], flush=True)
    r = drv('base', 'call', 'sessions.patch', json.dumps({'key': key2, 'model': CLI}), '400', scopes=ADM); print('patch cli', r.stdout[:400], flush=True)
    r = drv('base', 'call', 'chat.send', json.dumps({'sessionKey': key2, 'message': 'Question before silent activity', 'idempotencyKey': str(__import__('uuid').uuid4())}), '400', scopes=ADM); print('send', r.stdout[:400], flush=True)
    for _ in range(120):
        h = drv('base', 'call', 'chat.history', json.dumps({'sessionKey': key2, 'limit': 10}), '100000')
        if 'fake-claude reply' in h.stdout: break
        time.sleep(1)
    print('cli turn done' if 'fake-claude reply' in h.stdout else 'cli turn MISSING ' + h.stdout[:600], flush=True)
    for i in range(251):
        r = drv('base', 'call', 'chat.inject', json.dumps({'sessionKey': key2, 'message': 'Visible final answer' if i == 250 else 'NO_REPLY'}), '300', scopes=ADM)
        if '"ok":true' not in r.stdout: print('cli inject fail', i, r.stdout[:300], flush=True); break
    r = drv('base', 'call', 'sessions.patch', json.dumps({'key': key2, 'model': None}), '600', scopes=ADM); print('switch', r.stdout[:600], flush=True)
    h = drv('base', 'call', 'chat.history', json.dumps({'sessionKey': key2, 'limit': 2}), '100000')
    try:
        pl = json.loads(h.stdout)['payload']
        print('cli history provider', pl.get('defaults', {}).get('modelProvider'), 'total', pl.get('totalMessages'), 'messages',
              [json.dumps(m.get('content'))[:60] for m in pl.get('messages', [])], 'binding', 'cliSessionBindings' in h.stdout or 'claude-cli' in h.stdout, flush=True)
    except Exception as e: print('cli history parse', e, h.stdout[:400], flush=True)
    keys = json.load(open(f'{W}/scripts/ops_trace.json'))[0]['params']
    claude = [p['sessionKey'] for p in keys if 'catalog-import' in p['sessionKey']]
    for k in claude:  # provider and CLI binding of each imported Claude session, as chat.history reports them
        r = drv('base', 'call', 'chat.history', json.dumps({'sessionKey': k, 'limit': 2}), '100000')
        try:
            pl = json.loads(r.stdout)['payload']; si = pl.get('sessionInfo', {})
            print('claude', k[-12:], 'provider', pl.get('defaults', {}).get('modelProvider'), si.get('modelProvider'), 'messages', len(pl.get('messages', [])),
                  'total', pl.get('totalMessages'), 'cli', [x for x in json.dumps(si).split('"') if 'claude' in x.lower()][:4], flush=True)
        except Exception as e: print('claude parse', k[-12:], e, r.stdout[:300], flush=True)
    r = drv('base', 'call', 'chat.history', json.dumps({'sessionKey': key, 'limit': 2}), '1500'); print('history', r.stdout[:1500], flush=True)
    stop(gw)
    sql('DROP DATABASE IF EXISTS seed_s', 'CREATE DATABASE seed_s TEMPLATE openclaw')
    shutil.rmtree(f'{W}/seed/home-s', ignore_errors=True); subprocess.run(['cp', '-Rc', H, f'{W}/seed/home-s'], check=True)
    json.dump([{'name': 'chat.history', 'method': 'chat.history', 'weight': 1,
                'params': [{'sessionKey': key, 'limit': 2}, {'sessionKey': key2, 'limit': 2}] + [{'sessionKey': k, 'limit': 2} for k in claude]}], open(f'{W}/scripts/ops_sparse.json', 'w'))
    print('SPARSE_SEED_DONE', 'switched:', claude[-1][-12:], flush=True)
elif mode == 'trace':
    arm, tag = sys.argv[2], sys.argv[3]; out = f'{W}/results/{tag}'; os.makedirs(out, exist_ok=True)
    tpl, hsrc, opsf = (('seed_s', f'{W}/seed/home-s', 'ops_sparse.json') if os.environ.get('SPARSE') else ('seed_t', f'{W}/seed/home', 'ops_trace.json'))
    H = f'{W}/run/home'; shutil.rmtree(f'{W}/run', ignore_errors=True); os.makedirs(f'{W}/run')
    subprocess.run(['cp', '-Rc', hsrc, H], check=True); fresh_db(tpl)
    gw = boot(arm, H, f'{out}/gateway')
    keys = json.load(open(f'{W}/scripts/{opsf}'))[0]['params']
    for _ in range(2):  # warm both the worker and the snapshot caches
        for p in keys: drv(arm, 'call', 'chat.history', json.dumps(p), '100')
    sql("ALTER SYSTEM SET log_timezone = 'America/Los_Angeles'", 'ALTER SYSTEM SET log_min_duration_statement = 0', 'SELECT pg_reload_conf()'); time.sleep(1)
    since = time.strftime('%Y-%m-%dT%H:%M:%S'); marks = []
    for p in keys:
        for _ in range(3):
            t1 = time.time(); rr = drv(arm, 'call', 'chat.history', json.dumps(p), '100000000')
            marks.append({'key': p['sessionKey'], 'start': t1, 'end': time.time(), 'ok': '"ok":true' in rr.stdout,
                          'messages': rr.stdout.count('"role":')}); time.sleep(0.5)
    time.sleep(1); sql('ALTER SYSTEM RESET log_min_duration_statement', 'SELECT pg_reload_conf()')
    logs = subprocess.run(DK + ['logs', '--since', since, 'pc190001-pg'], capture_output=True, text=True)
    open(f'{out}/trace.log', 'w').write(logs.stdout + logs.stderr); json.dump(marks, open(f'{out}/trace_marks.json', 'w'), indent=1)
    if os.environ.get('LOAD_S'):  # closed-loop latency per session shape, statement logging off
        for label, p in (('sparse', keys[0]), ('cli', keys[1])):
            ops = f'{out}/load_ops-{label}.json'
            json.dump([{'name': 'chat.history', 'method': 'chat.history', 'weight': 1, 'params': [p]}], open(ops, 'w'))
            for c in os.environ.get('LOAD_C', '1').split(','):
                drv(arm, 'load', '5', c, f'{out}/warm-{label}-c{c}.json', ops)  # unmeasured warmup at this concurrency
                la0 = os.getloadavg()[0]
                drv(arm, 'load', os.environ['LOAD_S'], c, f'{out}/load-{label}-c{c}.json', ops)
                r = json.load(open(f'{out}/load-{label}-c{c}.json')); r['load1'] = [round(la0, 2), round(os.getloadavg()[0], 2)]
                json.dump(r, open(f'{out}/load-{label}-c{c}.json', 'w'), indent=1)
                print(tag, label, f'c{c}', json.dumps(r['perOp']['chat.history']), 'load1', r['load1'], flush=True)
    stop(gw)
    a = subprocess.run(['python3', '-I', f'{W}/scripts/trace_ana.py', out], capture_output=True, text=True)
    open(f'{out}/analysis.txt', 'w').write(a.stdout + a.stderr); print(tag, a.stdout.strip().splitlines()[-1] if a.stdout.strip() else a.stderr[-500:], flush=True)
