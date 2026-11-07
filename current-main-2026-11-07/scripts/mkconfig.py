# usage: python3 -I mkconfig.py <home> <port> <engine:sqlite|postgres>
import json, sys, os
home, port, engine = sys.argv[1], int(sys.argv[2]), sys.argv[3]
agents = ["main","dev","researcher","troubleshooter","wiki-maint","dev-go","dev-react","wb-dev","wb-review","wb-triage","wb-dev2"]
cfg = {
  "browser": {"enabled": False},
  "update": {"checkOnStart": False},
  "discovery": {"mdns": {"mode": "off"}},
  "gateway": {"mode": "local", "port": port, "bind": "loopback", "auth": {"mode": "none"},
              "controlUi": {"enabled": False}, "tailscale": {"mode": "off"}},
  "cron": {"enabled": False},
  "agents": {"ownership": "explicit",
             "entries": {a: {"workspace": f"{home}/.openclaw/workspace-{a}"} for a in agents}},
  "plugins": {"enabled": True, "allow": ["memory-core", "workboard"],
              "entries": {"browser": {"enabled": False},
                          "memory-core": {"enabled": True, "config": {"dreaming": {"enabled": False}}},
                          "workboard": {"enabled": True}}},
  "memory": {"search": {"enabled": False}},
}
if engine == "postgres":
    cfg["database"] = {"engine": "postgres",
                       "postgres": {"connection": {"source": "env", "provider": "default", "id": "OPENCLAW_DATABASE_DSN"}}}
os.makedirs(f"{home}/.openclaw", exist_ok=True)
json.dump(cfg, open(f"{home}/.openclaw/openclaw.json", "w"), indent=1)
print(f"{home}/.openclaw/openclaw.json")
