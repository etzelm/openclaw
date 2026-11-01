# L3d synthetic seed plan (deterministic). Shape follows the L3 bench store: 200 sessions, most small,
# a long tail of large transcripts, and Claude CLI sessions whose tool rows hide between visible turns.
# usage: python3 -I mkplan.py <home> <plan.json>
import json, os, random, sys, uuid
home, out = sys.argv[1], sys.argv[2]
rng = random.Random(188956)
agents = ["main"] * 50 + ["dev"] * 70 + ["researcher"] * 15 + ["wb-dev"] * 15 + ["troubleshooter"] * 10 + ["wiki-maint"] * 10
rng.shuffle(agents)
tiers = [("tiny", 55, (2, 6), (60, 200)), ("medium", 85, (20, 300), (60, 250)),
         ("large", 25, (400, 1500), (200, 1500)), ("huge", 5, (3000, 5000), (500, 3000))]
inject, i = [], 0
for tier, n, (m0, m1), (l0, l1) in tiers:
    for _ in range(n):
        count = rng.randint(m0, m1)
        inject.append({"agent": agents[i], "key": f"agent:{agents[i]}:bench-{tier}-{i:03d}", "tier": tier,
                       "seed": rng.randrange(1 << 30), "messages": [rng.randint(l0, l1) for _ in range(count)]})
        i += 1
claude_n = 30
proj = os.path.join(home, ".claude", "projects")
words = "postgres history worker queue bridge reply snapshot transcript page latency session agent tool read".split()
def para(n): return " ".join(rng.choice(words) for _ in range(n))
stats = []
for k in range(claude_n):
    cwd = f"/Users/bench/proj{k % 6}"
    d = os.path.join(proj, cwd.replace("/", "-"))
    os.makedirs(d, exist_ok=True)
    sid = str(uuid.UUID(int=rng.getrandbits(128), version=4))
    turns = rng.choice([rng.randint(5, 40), rng.randint(40, 200), rng.randint(200, 600)])
    rows, parent, ts = [], None, 1_790_000_000_000 + k * 10_000_000
    def add(kind, message):
        global parent, ts
        u = str(uuid.UUID(int=rng.getrandbits(128), version=4)); ts += rng.randint(500, 20000)
        rows.append({"type": kind, "uuid": u, "parentUuid": parent, "sessionId": sid, "cwd": cwd, "version": "2.1.0", "entrypoint": "cli", "userType": "external", "isSidechain": False,
                     "timestamp": __import__("datetime").datetime.utcfromtimestamp(ts / 1000).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z",
                     "message": message})
        parent = u
    for t in range(turns):
        add("user", {"role": "user", "content": para(rng.randint(5, 60))})
        # Hidden tool work between visible turns (sparse sessions).
        for j in range(rng.choice([0, 1, 2, 4, 8])):
            tid = f"toolu_{k:02d}{t:04d}{j:02d}"
            add("assistant", {"role": "assistant", "content": [{"type": "tool_use", "id": tid, "name": "Bash", "input": {"command": para(6)}}]})
            add("user", {"role": "user", "content": [{"type": "tool_result", "tool_use_id": tid, "content": para(rng.randint(20, 400))}]})
        add("assistant", {"role": "assistant", "content": [{"type": "text", "text": para(rng.randint(20, 300))}]})
    with open(os.path.join(d, f"{sid}.jsonl"), "w") as f:
        for r in rows: f.write(json.dumps(r) + "\n")
    stats.append({"sessionId": sid, "turns": turns, "rows": len(rows)})
json.dump({"inject": inject, "claude": claude_n, "claudeStats": stats}, open(out, "w"))
tot = sum(len(s["messages"]) for s in inject)
print(f"plan: {len(inject)} inject sessions, {tot} messages, {sum(sum(s['messages']) for s in inject)} chars; claude {claude_n} sessions, {sum(s['rows'] for s in stats)} rows")
