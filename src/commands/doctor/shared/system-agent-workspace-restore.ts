// Copies a system agent's files from the shared root into its own workspace before Doctor pins it.
import fs from "node:fs/promises";
import path from "node:path";
import {
  DEFAULT_MEMORY_FILENAME,
  GENERATED_WORKSPACE_BOOTSTRAP_FILENAMES,
  fileDiffersFromTemplate,
} from "../../../agents/workspace.js";
import { hasErrnoCode } from "../../../infra/errno.js";

export type WorkspaceRestorePlan = {
  /** Relative paths copied from the root; seeded template files in the target are replaced. */
  copies: string[];
  /** Relative paths customized differently in both directories; the target keeps its own. */
  conflicts: string[];
};

const TEMPLATED_FILES: ReadonlySet<string> = new Set(GENERATED_WORKSPACE_BOOTSTRAP_FILENAMES);
const RESTORED_DIRS = ["memory", "skills"] as const;

async function readIfPresent(file: string): Promise<Buffer | undefined> {
  try {
    return await fs.readFile(file);
  } catch (error) {
    if (hasErrnoCode(error, "ENOENT")) {
      return undefined;
    }
    throw error;
  }
}

async function planFile(from: string, to: string, rel: string, plan: WorkspaceRestorePlan) {
  const templated = TEMPLATED_FILES.has(rel);
  const source = await readIfPresent(path.join(from, rel));
  if (!source || (templated && !(await fileDiffersFromTemplate(from, rel)))) {
    return;
  }
  const target = await readIfPresent(path.join(to, rel));
  if (!target || (templated && !(await fileDiffersFromTemplate(to, rel)))) {
    plan.copies.push(rel);
  } else if (!target.equals(source)) {
    plan.conflicts.push(rel);
  }
}

async function planTree(from: string, to: string, rel: string, plan: WorkspaceRestorePlan) {
  let entries;
  try {
    entries = await fs.readdir(path.join(from, rel), { withFileTypes: true });
  } catch (error) {
    if (hasErrnoCode(error, "ENOENT")) {
      return;
    }
    throw error;
  }
  for (const entry of entries.toSorted((a, b) => a.name.localeCompare(b.name))) {
    const child = path.join(rel, entry.name);
    if (entry.isDirectory()) {
      await planTree(from, to, child, plan);
    } else if (entry.isFile()) {
      await planFile(from, to, child, plan);
    }
  }
}

/** Lists the persona, memory, and skill files `from` holds that `to` lacks or still has as a seed. */
export async function planWorkspaceRestore(
  from: string,
  to: string,
): Promise<WorkspaceRestorePlan> {
  const plan: WorkspaceRestorePlan = { copies: [], conflicts: [] };
  for (const name of [...GENERATED_WORKSPACE_BOOTSTRAP_FILENAMES, DEFAULT_MEMORY_FILENAME]) {
    await planFile(from, to, name, plan);
  }
  for (const dir of RESTORED_DIRS) {
    await planTree(from, to, dir, plan);
  }
  return plan;
}

/** Copies the planned files; the root keeps every original and no customized target is replaced. */
export async function applyWorkspaceRestore(
  from: string,
  to: string,
  plan: WorkspaceRestorePlan,
): Promise<void> {
  for (const rel of plan.copies) {
    const target = path.join(to, rel);
    await fs.mkdir(path.dirname(target), { recursive: true });
    // A seeded template is replaced; any other target must still be absent.
    await fs.copyFile(
      path.join(from, rel),
      target,
      TEMPLATED_FILES.has(rel) ? 0 : fs.constants.COPYFILE_EXCL,
    );
  }
}
