// Creates an isolated profile: converged explicit roster (main, dev), systemAgent main, no authored
// workspaces, mock OpenAI provider, synthetic key. Seeds the case's workspace files.
// usage: node --import <repo>/scripts/tsx.mjs setup-profile.mjs --repo <repo> --root <new dir> --port <port> --case root|subdir|neither|both
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const { values } = parseArgs({ options: { repo: { type: "string" }, root: { type: "string" }, port: { type: "string" }, case: { type: "string" } } });
const repo = path.resolve(values.repo);
const root = path.resolve(values.root);
const port = Number(values.port);
const imp = (p) => import(pathToFileURL(path.join(repo, p)).href);
const { BASE_GATEWAY_BENCH_CONFIG } = await imp("scripts/lib/gateway-bench-runtime.ts");
const { applyMockOpenAiModelConfig } = await imp("scripts/e2e/lib/fixtures/mock-openai-config.mjs");

mkdirSync(root);
const shared = path.join(root, "workspace");
const write = (rel, text) => {
  mkdirSync(path.dirname(path.join(shared, rel)), { recursive: true });
  writeFileSync(path.join(shared, rel), text);
};
// A sibling agent's file under the shared root, the sandbox probe target.
write("dev/SOUL.md", "PROOF-MARKER-DEV-SIBLING: dev agent persona.\n");
if (["root", "both", "agentsmd"].includes(values.case)) {
  write("SOUL.md", "PROOF-MARKER-ROOT-SOUL: persona kept in the shared workspace root.\n");
  write("MEMORY.md", "root long-term memory\n");
  write("memory/2026-10-01.md", "root daily memory\n");
}
if (["subdir", "both", "env", "tilde", "include"].includes(values.case)) {
  write("main/SOUL.md", "PROOF-MARKER-SUBDIR-SOUL: persona kept in the agent directory.\n");
  write("main/memory/2026-10-01.md", "subdirectory daily memory\n");
}

if (values.case === "agentsmd") {
  write("main/AGENTS.md", "PROOF-MARKER-SUBDIR-AGENTS: customized agent instructions kept in the agent directory.\n");
}

const config = structuredClone(BASE_GATEWAY_BENCH_CONFIG);
config.memory = { search: { enabled: false } };
config.plugins.slots = { memory: "none" };
applyMockOpenAiModelConfig(config, { mockPort: port + 1 });
config.agents.defaults = {
  ...config.agents.defaults,
  workspace: { env: "${WORKSPACE_ROOT}", include: "${WORKSPACE_ROOT}", tilde: "~/workspace" }[values.case] ?? shared,
  heartbeat: { every: "0m" },
  skills: [],
  modelPolicy: {},
  systemAgent: { agentId: "main" },
};
config.agents.ownership = "explicit";
config.agents.entries = { main: {}, dev: {} };
if (values.case === "include") {
  writeFileSync(path.join(root, "defaults.json5"), `${JSON.stringify(config.agents.defaults, null, 2)}\n`);
  config.agents.defaults = { $include: "./defaults.json5" };
}
writeFileSync(path.join(root, "openclaw.json"), `${JSON.stringify(config, null, 2)}\n`);
console.log(`profile ready: case=${values.case}`);
