// Bench-only: re-seal each restored schema of the scratch copy with the fingerprint of its
// restored catalog. pg_restore packs column positions (attnum) that the live tables have with
// dropped-column gaps, so the copied seal can never match. Same hashing as postgres-schema.ts.
// usage: node_modules/.bin/tsx reseal_fp.ts <src-dir> <socket-dir> <port> <db>
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import path from "node:path";

const [srcDir, host, port, database] = process.argv.slice(2);
const require = createRequire(path.join(srcDir, "package.json"));
const pg = require("pg");
const catalogModule = await import(path.join(srcDir, "src/infra/database-engine/postgres-catalog.ts"));
const { postgresCatalogQuery, readPostgresCatalog } = catalogModule;
const hash = (text: string) => createHash("sha256").update(text).digest("hex");

const client = new pg.Client({ host, port: Number(port), user: "openclaw", database });
await client.connect();
const { rows: schemas } = await client.query(
  "select table_schema as ns from information_schema.tables where table_schema like 'restore_%' and table_name = 'openclaw_schema_meta' order by 1",
);
for (const { ns } of schemas) {
  // The bridge sets search_path to the namespace alone; format_type output depends on it.
  await client.query("SELECT set_config('search_path', $1, false)", [`"${ns}"`]);
  const { rows } = await client.query(
    `WITH captured AS (${postgresCatalogQuery(ns, true)}) SELECT catalog::text FROM captured`,
  );
  const catalog = readPostgresCatalog(JSON.parse(rows[0].catalog)) as Array<{ table?: string }>;
  const text = catalog
    .filter((fact) => fact.table !== "openclaw_schema_meta")
    .map((fact) => JSON.stringify(fact))
    .toSorted()
    .join("\n");
  const result = await client.query(
    `UPDATE "${ns}".openclaw_schema_meta SET fingerprint = $1, server_major = 17`,
    [hash(text)],
  );
  console.log(ns.slice(0, 16), "facts", catalog.length, "rows", result.rowCount);
}
await client.end();
