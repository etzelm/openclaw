// Prints the claude-cli binding stored for agent:main:main, read-only straight from the agent database
// (no OpenClaw code, so nothing migrates the store), and which directory its cwdHash names.
// usage: node binding.js <profile>
const { DatabaseSync } = require("node:sqlite");
const crypto = require("node:crypto");
const path = require("node:path");
const root = path.resolve(process.argv[2]);
const db = new DatabaseSync(path.join(root, "state/agents/main/agent/openclaw-agent.sqlite"), { readOnly: true });
const row = db.prepare("select entry_json from session_nodes where session_key = ?").get("agent:main:main");
const binding = row ? JSON.parse(row.entry_json).cliSessionBindings?.["claude-cli"] : undefined;
const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");
const names = { [sha(path.join(root, "workspace"))]: "<profile>/workspace", [sha(path.join(root, "workspace", "main"))]: "<profile>/workspace/main" };
const keys = binding ? Object.keys(binding).sort().join(",") : "";
console.log(`binding agent:main:main claude-cli: sessionId=${binding?.sessionId ?? "none"} cwdHash=${binding?.cwdHash === undefined ? "absent" : (names[binding.cwdHash] ?? "other")} fields=${keys}`);
