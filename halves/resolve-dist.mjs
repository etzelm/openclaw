// Resolve a built dist chunk exporting a symbol (by `export { x as name }` in the chunk).
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
const WANT = {
  searchKeywordWithFallback: /^manager-status-state-.*\.mjs$/,
  enableNodeSqliteKyselyStatementCache: /^kysely-sync-cache-state-.*\.mjs$/,
  openOpenClawAgentDatabaseReadOnly: /^openclaw-agent-db-readonly-open-.*\.mjs$/,
  ensureMemoryIndexSchema: /^memory-schema-.*\.mjs$/,
  openSqliteReadOnlyDatabase: /^sqlite-snapshot-source-.*\.mjs$/,
};
export async function resolveExport(armRoot, name) {
  const dist = path.join(armRoot, "dist");
  const re = WANT[name];
  const files = fs.readdirSync(dist).filter((f) => re.test(f));
  for (const f of files) {
    const src = fs.readFileSync(path.join(dist, f), "utf8");
    // Chunks end with `export { localName as a, ... }`; find the alias exported for `name`.
    for (const x of src.matchAll(/^export \{([^}]*)\}/gm)) {
      for (const part of x[1].split(",").map((p) => p.trim())) {
        const [local, alias] = part.split(" as ").map((p) => p.trim());
        if (local === name) {
          const mod = await import(pathToFileURL(path.join(dist, f)).href);
          return { file: f, fn: mod[alias ?? local], exportName: alias ?? local };
        }
      }
    }
  }
  throw new Error(`cannot resolve ${name} in ${dist}`);
}
