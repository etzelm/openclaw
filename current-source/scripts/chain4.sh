#!/bin/sh
# Round 2: seed, add 1 ms toxiproxy latency each way (about 2 ms added RTT), measure RTT, then 5 ABBA runs per arm
# (sparse + imported Claude sessions, limit 2) at concurrency 1 and 8. Each run starts only when the 1-minute load
# average is below the core count.
W=$HOME/work/pc-190001; cd $W || exit 1
T=localhost:58474/proxies/pg/toxics
gate() { python3 -I -c "
import os, time, sys
n = os.cpu_count(); t0 = time.time()
while os.getloadavg()[0] >= n and time.time() - t0 < 3600: time.sleep(15)
print('gate', sys.argv[1], 'load1=%.2f cores=%d waited=%ds' % (os.getloadavg()[0], n, time.time() - t0), flush=True)" "$1"; }
rtt() { python3 -I scripts/rtt.py > logs/rtt-$1.txt 2>&1; tail -1 logs/rtt-$1.txt; }
[ -n "$SKIP_CONF" ] || sh scripts/conf.sh fix green-newhead src/config/sessions/session-history-read-snapshot.postgres.test.ts \
  src/config/sessions/session-accessor.sqlite-read-hold.postgres.test.ts src/infra/postgres-sync src/state/openclaw-agent-db.postgres.test.ts \
  src/state/openclaw-agent-db-engine.postgres.test.ts src/state/openclaw-state-db.postgres.test.ts
tail -1 logs/conformance-green-newhead.log
python3 -I scripts/run.py seed || exit 1
python3 -I scripts/run.py sparse-seed || exit 1
rtt no-toxic
curl -s -X POST $T -d '{"name":"down","type":"latency","stream":"downstream","attributes":{"latency":1,"jitter":0}}' > /dev/null
curl -s -X POST $T -d '{"name":"up","type":"latency","stream":"upstream","attributes":{"latency":1,"jitter":0}}' > /dev/null
curl -s localhost:58474/proxies/pg/toxics; echo
rtt toxic
n=0
for a in base fix fix base base fix fix base base fix; do n=$((n+1)); gate $a-N$n; SPARSE=1 LOAD_S=20 LOAD_C=1,8 python3 -I scripts/run.py trace $a net-$a-N$n; done
rtt toxic-end
echo CHAIN4_DONE
