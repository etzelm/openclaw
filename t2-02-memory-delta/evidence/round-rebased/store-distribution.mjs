// store-distribution.mjs: aggregate chunk-per-path distribution of memory-source chunks. No path names printed.
import { DatabaseSync } from "node:sqlite";
const stores = [
  ["agent store A (430,518,272 bytes)", `${process.env.HOME}/work/t2-02-db/storeA.sqlite`],
  ["agent store B (4,855,853,056 bytes)", `${process.env.HOME}/work/t2-02-db/storeB.sqlite`],
];
for (const [label, file] of stores) {
  const db = new DatabaseSync(file, { readOnly: true });
  const per = db.prepare("SELECT path, COUNT(*) n FROM memory_index_chunks WHERE source = 'memory' GROUP BY path").all().map((r) => Number(r.n));
  const total = per.reduce((a, b) => a + b, 0);
  const big = per.filter((n) => n > 100);
  console.log(`${label}:`);
  console.log(`  distinct memory paths: ${per.length}`);
  console.log(`  total chunks: ${total}`);
  console.log(`  mean chunks per path: ${per.length ? (total / per.length).toFixed(2) : "0.00"}`);
  console.log(`  max chunks per path: ${per.length ? Math.max(...per) : 0}`);
  console.log(`  paths with more than 100 chunks: ${big.length} (chunk total ${big.reduce((a, b) => a + b, 0)})`);
  console.log(`  paths with at least 19 chunks: ${per.filter((n) => n >= 19).length}`);
  db.close();
}
