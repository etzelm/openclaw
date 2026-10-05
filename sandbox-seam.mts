// Sandbox seam proof for the system agent main of a converged roster. For each workspace the real code
// can hand to sandbox setup (the Gateway launch input from listConfiguredOwnerInputs, and
// resolveAgentWorkspaceDir), runs the real sandbox layout and
// mount selection, then has the guest's file bridge (createSandboxFsBridge) read and write the sibling
// agent's file through every mount. No container runtime is available: a local backend shim runs the
// bridge's generated shell scripts on the host, rewriting each container mount root to its host root
// the way a bind mount would. Read-only enforcement shown here is the bridge's, not the kernel's.
// usage: REPO=<checkout> node --import <checkout>/scripts/tsx.mjs sandbox-seam.mts <config.json> <profile> <label>
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repo = path.resolve(process.env.REPO!);
const [configPath, profile, label] = process.argv.slice(2);
const imp = (p: string) => import(pathToFileURL(path.join(repo, p)).href);
const scope = await imp("src/agents/agent-scope-config.ts");
const { resolveDefaultAgentWorkspaceDir } = await imp("src/agents/workspace-default-path.ts");
const { listConfiguredOwnerInputs } = await imp("src/agents/prepared-model-runtime.configured.ts");
const { resolveSandboxWorkspaceLayoutPaths } = await imp("src/agents/sandbox/shared.ts");
const { createSandboxFsBridge } = await imp("src/agents/sandbox/fs-bridge.ts");
const { buildSandboxFsMounts } = await imp("src/agents/sandbox/fs-paths.ts");
const { createSandboxTestContext } = await imp("src/agents/sandbox/test-fixtures.ts");

const cfg = JSON.parse(await fs.readFile(configPath, "utf8"));
const red = (s: unknown) => String(s).split(profile).join("<profile>");
const launchDefault =
  scope.tryResolveConfiguredAgentWorkspaceDir(cfg) ?? resolveDefaultAgentWorkspaceDir();
const operatorDir = listConfiguredOwnerInputs(cfg, launchDefault).find(
  (input: { agentId: string }) => input.agentId === "main",
).workspaceDir;
const scheduledDir = scope.resolveAgentWorkspaceDir(cfg, "main");
const sibling = path.join(cfg.agents.defaults.workspace, "dev", "SOUL.md");
const siblingBytes = await fs.readFile(sibling, "utf8");

function shim(mounts: { hostRoot: string; containerRoot: string }[]) {
  const ordered = mounts.toSorted((a, b) => b.containerRoot.length - a.containerRoot.length);
  const byHost = mounts.toSorted((a, b) => b.hostRoot.length - a.hostRoot.length);
  const map = (s: string) => {
    for (const m of ordered) {
      if (s === m.containerRoot || s.startsWith(`${m.containerRoot}/`)) {
        return m.hostRoot + s.slice(m.containerRoot.length);
      }
    }
    return s;
  };
  // A bind mount reports guest paths; translate host paths printed by the script back to them.
  const unmap = (text: string) =>
    text.replace(/\/[^\0\n]*/g, (p) => {
      for (const m of byHost) {
        if (p === m.hostRoot || p.startsWith(`${m.hostRoot}/`)) {
          return m.containerRoot + p.slice(m.hostRoot.length);
        }
      }
      return p;
    });
  return {
    id: "local-shim",
    runtimeId: "local-shim",
    runtimeLabel: "local-shim",
    workdir: "/workspace",
    buildExecSpec: async ({ command, env }: { command: string; env: Record<string, string> }) => ({
      argv: ["sh", "-c", command],
      env,
      stdinMode: "pipe-closed",
    }),
    runShellCommand: (params: any) =>
      new Promise((resolve, reject) => {
        const child = spawn("sh", ["-c", params.script, "openclaw-sandbox-fs", ...(params.args ?? []).map(map)], { stdio: ["pipe", "pipe", "pipe"] });
        const out: Buffer[] = [];
        const err: Buffer[] = [];
        child.stdout.on("data", (c) => out.push(c));
        child.stderr.on("data", (c) => err.push(c));
        child.on("error", reject);
        child.on("close", (code) => {
          const raw = Buffer.concat(out);
          const text = raw.toString("utf8");
          const stdout = text.includes("\uFFFD") ? raw : Buffer.from(unmap(text));
          const result = { stdout, stderr: Buffer.concat(err), code: code ?? 0 };
          if (result.code !== 0 && !params.allowFailure) {
            reject(new Error(result.stderr.toString("utf8").trim() || `shell exited ${result.code}`));
            return;
          }
          resolve(result);
        });
        child.stdin.end(params.stdin);
      }),
  };
}

console.log(`## sandbox seam ${label}`);
console.log(`launch workspace (listConfiguredOwnerInputs; the operator, agent RPC and cron turns ran here): ${red(operatorDir)}`);
console.log(`resolver workspace (resolveAgentWorkspaceDir; persona, bootstrap and memory files): ${red(scheduledDir)}`);
for (const [kind, workspaceDir] of [["launch", operatorDir], ["resolver", scheduledDir]] as const) {
  for (const access of ["none", "ro", "rw"] as const) {
    const layout = resolveSandboxWorkspaceLayoutPaths({
      cfg: { scope: "session", workspaceAccess: access, workspaceRoot: path.join(profile, "sandboxes") },
      rawSessionKey: `agent:main:${kind}-proof`,
      agentId: "main",
      workspaceDir,
    });
    await fs.mkdir(layout.workspaceDir, { recursive: true });
    const base = createSandboxTestContext({
      overrides: {
        workspaceDir: layout.workspaceDir,
        agentWorkspaceDir: layout.agentWorkspaceDir,
        workspaceAccess: access,
        containerWorkdir: "/workspace",
      },
    });
    const mounts = buildSandboxFsMounts(base);
    const sandbox = { ...base, backend: shim(mounts) };
    const bridge = createSandboxFsBridge({ sandbox });
    const mountText = mounts
      .filter((m: { source: string }) => m.source !== "protectedSkill")
      .map((m: any) => `${m.containerRoot} <- ${red(m.hostRoot)} (${m.writable ? "rw" : "ro"})`)
      .join("; ");
    console.log(`\n[${kind} workspace, workspaceAccess=${access}] mounts: ${mountText}`);
    await fs.writeFile(path.join(layout.workspaceDir, "CONTROL.md"), "control bytes");
    try {
      const control = (await bridge.readFile({ filePath: "/workspace/CONTROL.md" })).toString("utf8");
      console.log(`  control: guest reads /workspace/CONTROL.md in its own mount: ${control === "control bytes" ? "ok" : "MISMATCH"}`);
    } catch (e) {
      console.log(`  control: guest read of its own mount FAILED: ${red((e as Error).message).split("\n")[0]}`);
    } finally {
      await fs.rm(path.join(layout.workspaceDir, "CONTROL.md"), { force: true });
    }
    for (const guestPath of ["/workspace/dev/SOUL.md", "/agent/dev/SOUL.md"]) {
      let read: string;
      try {
        const bytes = (await bridge.readFile({ filePath: guestPath })).toString("utf8");
        read = bytes === siblingBytes ? "READ sibling dev/SOUL.md" : `read other bytes: ${bytes.slice(0, 40)}`;
      } catch (e) {
        read = `denied: ${red((e as Error).message).split("\n")[0]}`;
      }
      const probe = guestPath.replace("SOUL.md", "PROBE.md");
      const hostProbe = path.join(path.dirname(sibling), "PROBE.md");
      let write: string;
      try {
        await bridge.writeFile({ filePath: probe, data: `written by main guest via ${guestPath}` });
        write = (await fs.stat(hostProbe).then(() => true, () => false))
          ? "WROTE sibling dev/PROBE.md on the host"
          : "sibling untouched (write stayed inside its own mount)";
      } catch (e) {
        write = `denied: ${red((e as Error).message).split("\n")[0]}`;
      }
      await fs.rm(hostProbe, { force: true });
      const ownProbe = path.join(layout.workspaceDir, "dev", "PROBE.md");
      await fs.rm(ownProbe, { force: true });
      await fs.rmdir(path.dirname(ownProbe)).catch(() => undefined);
      console.log(`  guest ${guestPath}: ${read} | write ${probe}: ${write}`);
    }
  }
}
