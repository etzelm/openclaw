// Evidence script: real resolvers, real owner-input publication, real run-workspace resolver and
// real CLI reuse decision. Run from outside the checkout with REPO pointing at it:
//   REPO=<checkout> node --import <checkout>/scripts/tsx.mjs seam-proof.ts
import path from "node:path";
import { pathToFileURL } from "node:url";
const repo = process.env.REPO!;
const imp = (p: string) => import(pathToFileURL(path.join(repo, p)).href);
const { resolveAgentWorkspaceDir, tryResolveConfiguredAgentWorkspaceDir } = await imp("src/agents/agent-scope-config.ts");
const { hashCliSessionText, resolveCliSessionReuse } = await imp("src/agents/cli-session.ts");
const { listConfiguredOwnerInputs } = await imp("src/agents/prepared-model-runtime.configured.ts");
const { resolveDefaultAgentWorkspaceDir } = await imp("src/agents/workspace-default.ts");
const { resolveRunWorkspaceDir } = await imp("src/agents/workspace-run.ts");
const { resolveUserPath } = await imp("src/utils.ts");
const ws = "/tmp/oc-repro/workspace";
const base = (system: string, extra: Record<string, unknown> = {}): any => ({
  agents: {
    ownership: "explicit",
    defaults: { workspace: ws, systemAgent: { agentId: system } },
    entries: { main: {}, research: {}, dev: {}, ...extra },
  },
});
const sole: any = base("main");
delete sole.agents.ownership;
sole.agents.entries = { main: {} };
const cases: [string, any, string][] = [
  ["A converged roster, system agent main, no workspace", base("main"), "main"],
  ["A2 converged roster, system agent research, no workspace", base("research"), "research"],
  ["A' same config as A, non-owner dev", base("main"), "dev"],
  ["B main.workspace pinned to defaults", base("main", { main: { workspace: ws } }), "main"],
  ["C sole agent", sole, "main"],
];
const short = (h?: string) => h?.slice(0, 12);
for (const [label, cfg, agent] of cases) {
  const launch = tryResolveConfiguredAgentWorkspaceDir(cfg) ?? resolveDefaultAgentWorkspaceDir();
  const operator = listConfiguredOwnerInputs(cfg, launch).find((i: any) => i.agentId === agent)?.workspaceDir;
  const wake = resolveUserPath(resolveAgentWorkspaceDir(cfg, agent));
  const hash = (dir?: string) =>
    hashCliSessionText(resolveRunWorkspaceDir({ workspaceDir: dir, agentId: agent, config: cfg }).workspaceDir);
  const reuse = resolveCliSessionReuse({
    binding: { sessionId: "s", cwdHash: hash(operator) },
    authEpochVersion: 1,
    cwdHash: hash(wake),
  });
  console.log(label);
  console.log(`  resolveAgentWorkspaceDir (wake)        = ${wake}`);
  console.log(`  published owner input (operator)       = ${operator}`);
  console.log(`  cwdHash operator / wake                = ${short(hash(operator))} / ${short(hash(wake))}`);
  console.log(`  resolveCliSessionReuse                 = ${JSON.stringify(reuse)}`);
}
