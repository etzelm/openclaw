// Compile candidate fixes for the kernel.ts:257 status filter with the installed Kysely (no database).
// Usage: node compile-fix-candidates.mjs <path to node_modules/kysely>
import process from "node:process";
import { pathToFileURL } from "node:url";
import { join } from "node:path";

const kyselyDir = process.argv[2];
const { Kysely, SqliteAdapter, SqliteIntrospector, SqliteQueryCompiler, DummyDriver, sql } = await import(
  pathToFileURL(join(kyselyDir, "dist", "index.js")).href
);
const db = new Kysely({
  dialect: {
    createAdapter: () => new SqliteAdapter(),
    createDriver: () => new DummyDriver(),
    createIntrospector: (k) => new SqliteIntrospector(k),
    createQueryCompiler: () => new SqliteQueryCompiler(),
  },
});
const STATUSES = ["queued", "sent", "replied"];
const base = () =>
  db
    .selectFrom("conversation_deliveries as delivery")
    .innerJoin("conversations as conversation", "conversation.conversation_id", "delivery.conversation_id")
    .selectAll("delivery")
    .select("conversation.channel as channel")
    .where("delivery.conversation_id", "=", "CONVERSATION_REF")
    .where("delivery.operation_kind", "=", "turn")
    .where((eb) =>
      eb.or([
        eb("delivery.platform_message_id", "=", "REPLY_TO_ID"),
        eb("delivery.prepared_message_id", "=", "REPLY_TO_ID"),
      ]),
    );
const finish = (q) => q.orderBy("delivery.updated_at", "desc").limit(1).compile();
const candidates = {
  "main: .where(col, 'in', [...strings])": finish(base().where("delivery.status", "in", STATUSES)),
  "fix A: .where(col, 'in', STATUSES.map((s) => sql.lit(s)))": finish(
    base().where("delivery.status", "in", STATUSES.map((s) => sql.lit(s))),
  ),
  "fix B: .where(sql`delivery.status in (${sql.join(STATUSES.map((s) => sql.lit(s)))})`)": finish(
    base().where(sql`"delivery"."status" in (${sql.join(STATUSES.map((s) => sql.lit(s)))})`),
  ),
};
const version = (await import(pathToFileURL(join(kyselyDir, "package.json")).href, { with: { type: "json" } })).default.version;
console.log(`kysely ${version}, node ${process.version}`);
for (const [name, c] of Object.entries(candidates)) {
  console.log(`\n## ${name}\n${c.sql}\nparameters ${JSON.stringify(c.parameters)}`);
}
