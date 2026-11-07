# Small deterministic seed plan for the chat.history statement trace.
# usage: python3 -I mkplan_small.py <home> <plan.json>
# 8 injected sessions (2..600 visible messages) and 4 Claude CLI threads with hidden tool rows between turns.
import datetime, json, os, random, sys, uuid
home, out = sys.argv[1], sys.argv[2]
rng = random.Random(190001)
sizes = [(2, "main"), (12, "dev"), (40, "main"), (120, "dev"), (252, "main"), (252, "dev"), (400, "main"), (600, "dev")]
inject = [{"agent": a, "key": f"agent:{a}:trace-{i:02d}-{n}", "seed": rng.randrange(1 << 30),
           "messages": [rng.randint(60, 600) for _ in range(n)]} for i, (n, a) in enumerate(sizes)]
words = "postgres history worker queue bridge reply snapshot transcript page latency session agent tool read".split()
def para(n): return " ".join(rng.choice(words) for _ in range(n))
proj = os.path.join(home, ".claude", "projects"); stats = []
for k, turns in enumerate([10, 60, 126, 250]):
    cwd = f"<home>/proj{k}"; d = os.path.join(proj, cwd.replace("/", "-")); os.makedirs(d, exist_ok=True)
    sid = str(uuid.UUID(int=rng.getrandbits(128), version=4)); rows = []; parent = None; ts = 1_790_000_000_000 + k * 10_000_000
    def add(kind, message):
        global parent, ts
        u = str(uuid.UUID(int=rng.getrandbits(128), version=4)); ts += rng.randint(500, 20000)
        rows.append({"type": kind, "uuid": u, "parentUuid": parent, "sessionId": sid, "cwd": cwd, "version": "2.1.0", "entrypoint": "cli",
                     "userType": "external", "isSidechain": False,
                     "timestamp": datetime.datetime.utcfromtimestamp(ts / 1000).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z", "message": message})
        parent = u
    for t in range(turns):
        add("user", {"role": "user", "content": para(rng.randint(5, 60))})
        for j in range(rng.choice([1, 2, 4, 8])):
            tid = f"toolu_{k:02d}{t:04d}{j:02d}"
            add("assistant", {"role": "assistant", "content": [{"type": "tool_use", "id": tid, "name": "Bash", "input": {"command": para(6)}}]})
            add("user", {"role": "user", "content": [{"type": "tool_result", "tool_use_id": tid, "content": para(rng.randint(20, 400))}]})
        add("assistant", {"role": "assistant", "content": [{"type": "text", "text": para(rng.randint(20, 300))}]})
    with open(os.path.join(d, f"{sid}.jsonl"), "w") as f:
        for r in rows: f.write(json.dumps(r) + "\n")
    stats.append({"sessionId": sid, "turns": turns, "rows": len(rows)})
json.dump({"inject": inject, "claude": len(stats), "claudeStats": stats}, open(out, "w"))
print(f"plan: {len(inject)} inject sessions, {sum(len(s['messages']) for s in inject)} messages; claude {len(stats)} threads, {sum(s['rows'] for s in stats)} rows")
