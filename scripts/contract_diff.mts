// Bench-only: diff a restored state schema against main's expected state catalog (same filters
// as admitStatePostgres). usage: tsx contract_diff.mts <src-dir> <socket> <port> <db> <namespace>
import { createRequire } from "node:module";
import path from "node:path";
const [srcDir, host, port, database, ns] = process.argv.slice(2);
const pg = createRequire(path.join(srcDir, "package.json"))("pg");
const { postgresCatalogQuery, readPostgresCatalog } = await import(path.join(srcDir, "src/infra/database-engine/postgres-catalog.ts"));
const { statePostgresRuntime: runtime } = await import(path.join(srcDir, "src/state/postgres-schema.generated/runtime.ts"));
const client = new pg.Client({ host, port: Number(port), user: "openclaw", database });
await client.connect();
await client.query("SELECT set_config('search_path', $1, false)", [`"${ns}"`]);
const { rows } = await client.query(`WITH c AS (${postgresCatalogQuery(ns)}) SELECT catalog::text FROM c`);
const catalog = readPostgresCatalog(JSON.parse(rows[0].catalog)) as Array<{ table: string; kind: string }>;
const tables = new Set(catalog.filter((f) => f.kind === "table").map((f) => f.table));
const absent = new Set(runtime.fragments.flatMap((fr: { tables: string[] }) => (fr.tables.some((t) => tables.has(t)) ? [] : fr.tables)));
const canon = (v: unknown) => JSON.stringify(v, (_k, x) => x !== null && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).toSorted(([a], [b]) => a.localeCompare(b, "en"))) : x);
const actual = new Set(catalog.filter((f) => !f.kind.endsWith("Definition") && f.table !== "openclaw_schema_meta").map(canon));
const expected = new Set(runtime.expectedCatalog.filter((f: { table: string }) => !absent.has(f.table)).map(canon));
const meta = await client.query(`SELECT version FROM "${ns}".openclaw_schema_meta`);
console.log("stored version", meta.rows[0]?.version, "absent fragments tables", absent.size);
for (const f of expected) if (!actual.has(f)) console.log("- expected", f.slice(0, 300));
for (const f of actual) if (!expected.has(f)) console.log("+ actual  ", f.slice(0, 300));
await client.end();
