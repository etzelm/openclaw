// PR 165112 real sandbox-turn harness. Subcommands: init | sandbox | controls | script
// All state lives under $PR_STAGE/profiles/<name>. Synthetic key only.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

const [cmd, name, ...rest] = process.argv.slice(2);
const STAGE = process.env.PR_STAGE;
const P = path.join(STAGE, "profiles", name);
const ROOT = path.join(P, "workspace");
const CFG = path.join(P, "state", "openclaw.json");
const DEV_MARKER = "PR165112-DEV-SOUL-MARKER sibling agent persona";

const readCfg = () => JSON.parse(fs.readFileSync(CFG, "utf8"));
const writeCfg = (c) => fs.writeFileSync(CFG, `${JSON.stringify(c, null, 2)}\n`);
const mkfile = (f, text) => {
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, text);
};

if (cmd === "init") {
  const [layout, mockPort, gwPort] = rest;
  fs.mkdirSync(path.join(P, "state"), { recursive: true });
  fs.mkdirSync(path.join(P, "home"), { recursive: true });
  const cost = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  const cfg = {
    gateway: { mode: "local", port: Number(gwPort), bind: "loopback", auth: { mode: "token", token: "pr165112-synthetic-token" } },
    models: {
      mode: "merge",
      providers: {
        openai: {
          baseUrl: `http://127.0.0.1:${mockPort}/v1`,
          apiKey: { source: "env", provider: "default", id: "OPENAI_API_KEY" },
          api: "openai-responses",
          agentRuntime: { id: "openclaw" },
          request: { allowPrivateNetwork: true },
          models: [
            { id: "gpt-5.6-luna", name: "gpt-5.6-luna", api: "openai-responses", agentRuntime: { id: "openclaw" }, reasoning: false, input: ["text", "image"], cost, contextWindow: 128000, contextTokens: 96000, maxTokens: 4096 },
          ],
        },
      },
    },
    agents: {
      ownership: "explicit",
      defaults: {
        workspace: ROOT,
        systemAgent: { agentId: "main" },
        model: { primary: "openai/gpt-5.6-luna" },
        models: { "openai/gpt-5.6-luna": { agentRuntime: { id: "openclaw" }, params: { transport: "sse", openaiWsWarmup: false } } },
      },
      entries: { main: {}, dev: {} },
    },
  };
  writeCfg(cfg);
  fs.mkdirSync(ROOT, { recursive: true });
  mkfile(path.join(ROOT, "dev", "SOUL.md"), `${DEV_MARKER}\n`);
  if (layout === "subdir") {
    mkfile(path.join(ROOT, "main", "SOUL.md"), "customized main persona (subdir layout)\n");
    fs.mkdirSync(path.join(ROOT, "main", "memory"), { recursive: true });
  } else if (layout === "rootonly") {
    mkfile(path.join(ROOT, "SOUL.md"), "customized main persona (root-only layout)\n");
    fs.mkdirSync(path.join(ROOT, "memory"), { recursive: true });
  } else if (layout !== "neither") {
    throw new Error(`unknown layout ${layout}`);
  }
} else if (cmd === "sandbox") {
  const [access] = rest;
  const cfg = readCfg();
  cfg.agents.defaults.sandbox = {
    mode: "all",
    backend: "docker",
    scope: "agent",
    workspaceAccess: access,
    docker: { image: "pr165112-sandbox:py", containerPrefix: "pr165112-sbx-", network: "none" },
  };
  writeCfg(cfg);
} else if (cmd === "controls") {
  const sweep = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) sweep(p);
      else if (e.name.startsWith("pr165112-")) fs.unlinkSync(p);
    }
  };
  sweep(ROOT);
  mkfile(path.join(ROOT, "dev", "SOUL.md"), `${DEV_MARKER}\n`);
  mkfile(path.join(ROOT, "pr165112-control.txt"), "CONTROL-ROOT\n");
  mkfile(path.join(ROOT, "main", "pr165112-control.txt"), "CONTROL-MAIN\n");
} else if (cmd === "script") {
  const [mockControl] = rest;
  const mk = (n, a) => {
    const ser = JSON.stringify(a);
    const sfx = createHash("sha256").update(n).update("\0").update(ser).digest("hex").slice(0, 10);
    const item = { type: "function_call", id: `fc_${sfx}`, call_id: `call_${n}_${sfx}`, name: n, arguments: ser };
    return {
      events: [
        { type: "response.output_item.added", item: { ...item, arguments: "" } },
        { type: "response.function_call_arguments.delta", delta: ser },
        { type: "response.output_item.done", item },
        { type: "response.completed", response: { id: `resp_${sfx}`, status: "completed", output: [item], usage: { input_tokens: 64, output_tokens: 16, total_tokens: 80, input_tokens_details: { cached_tokens: 0 } } } },
      ],
    };
  };
  const dev = "pr165112-write-probe";
  const probes = [
    ["read", { path: "pr165112-control.txt" }],
    ["read", { path: "/workspace/pr165112-control.txt" }],
    ["read", { path: "/agent/pr165112-control.txt" }],
    ["read", { path: "../dev/SOUL.md" }],
    ["read", { path: "/workspace/../dev/SOUL.md" }],
    ["read", { path: "/agent/../dev/SOUL.md" }],
    ["read", { path: "/workspace/dev/SOUL.md" }],
    ["read", { path: "/agent/dev/SOUL.md" }],
    ["write", { path: "pr165112-own-write.txt", content: "own-write\n" }],
    ["read", { path: "pr165112-own-write.txt" }],
    ["write", { path: `../dev/${dev}-rel.txt`, content: "x\n" }],
    ["write", { path: `/workspace/dev/${dev}-ws.txt`, content: "x\n" }],
    ["write", { path: `/agent/dev/${dev}-agent.txt`, content: "x\n" }],
    ["write", { path: "../dev/SOUL.md", content: "TAMPERED-BY-WRITE-TOOL\n" }],
    ["exec", { command: "pwd; echo ---mounts; grep -E ' /(workspace|agent) ' /proc/mounts; echo ---ls; ls -la / /workspace /agent 2>&1 | head -60" }],
    ["exec", { command: "cat pr165112-control.txt; echo rc=$?" }],
    ["exec", { command: "cat ../dev/SOUL.md; echo rc=$?" }],
    ["exec", { command: "cat /workspace/dev/SOUL.md; echo rc=$?" }],
    ["exec", { command: "cat /agent/dev/SOUL.md; echo rc=$?" }],
    ["exec", { command: "touch ../dev/pr165112-exec-touch-rel.txt; echo rc=$?" }],
    ["exec", { command: "touch /workspace/dev/pr165112-exec-touch-ws.txt; echo rc=$?" }],
    ["exec", { command: "touch /agent/dev/pr165112-exec-touch-agent.txt; echo rc=$?" }],
    ["exec", { command: "echo EXEC-TAMPER >> /workspace/dev/SOUL.md; echo rc=$?; echo EXEC-TAMPER2 >> /agent/dev/SOUL.md; echo rc=$?" }],
  ];
  const responses = [{ text: "recap" }, ...probes.map(([n, a]) => mk(n, a))];
  responses.push({ text: "PR165112 probes complete" });
  fs.writeFileSync(mockControl, JSON.stringify({ scriptVersion: `pr165112-${Date.now()}`, responses, default: { text: "PR165112 probes complete" } }));
  fs.writeFileSync(`${mockControl}.probes.json`, JSON.stringify(probes, null, 2));
} else {
  throw new Error(`unknown cmd ${cmd}`);
}
console.log(`ok ${cmd} ${name}`);
