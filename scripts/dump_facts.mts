// Bench-only: print one schema's catalog facts (sorted, namespace replaced by NS) for diffing.
// usage: tsx dump_facts.mts <src-dir> <socket-dir> <port> <db> <namespace>
import { createRequire } from "node:module";
import path from "node:path";
const [srcDir, host, port, database, ns] = process.argv.slice(2);
const pg = createRequire(path.join(srcDir, "package.json"))("pg");
const { postgresCatalogQuery, readPostgresCatalog } = await import(
  path.join(srcDir, "src/infra/database-engine/postgres-catalog.ts")
);
const client = new pg.Client({ host, port: Number(port), user: "openclaw", database });
await client.connect();
await client.query("SELECT set_config('search_path', $1, false)", [`"${ns}"`]);
const { rows } = await client.query(
  `WITH captured AS (${postgresCatalogQuery(ns, true)}) SELECT catalog::text FROM captured`,
);
const facts = readPostgresCatalog(JSON.parse(rows[0].catalog)) as Array<{ table?: string }>;
console.log(
  facts
    .filter((fact) => fact.table !== "openclaw_schema_meta")
    .map((fact) => JSON.stringify(fact).replaceAll(ns, "NS"))
    .toSorted()
    .join("\n"),
);
await client.end();
