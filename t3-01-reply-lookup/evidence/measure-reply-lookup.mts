// Production-path benchmark for the conversation reply lookup (partial index idx_agent_conversation_deliveries_reply).
// Imports the arm's own readConversationDeliveryInDatabase and openOpenClawAgentDatabase from the tree sources (via tsx).
// Usage (cwd = tree): ./node_modules/.bin/tsx <this file> --tree <tree> --arm BEFORE|AFTER --round N --state-root <dir> [--real-db <master.sqlite>]
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { DatabaseSync, StatementSync } from "node:sqlite";
import { pathToFileURL } from "node:url";

const argv = process.argv.slice(2);
const arg = (name: string, dflt?: string) => {
  const i = argv.indexOf(`--${name}`);
  if (i < 0) {
    if (dflt === undefined) throw new Error(`missing --${name}`);
    return dflt;
  }
  return argv[i + 1];
};
const TREE = path.resolve(arg("tree"));
const ARM = arg("arm");
const ROUND = arg("round");
const STATE_ROOT = path.resolve(arg("state-root"));
const REAL_DB = arg("real-db", "");
const STORES = arg("stores", "a,b,c,d,e").split(",");
const LOOKUPS = 200;
const WARMUPS = 2;
const SAMPLES = 5;

const kernelPath = path.join(TREE, "src/config/sessions/conversation-delivery-store.kernel.ts");
const agentDbPath = path.join(TREE, "src/state/openclaw-agent-db.ts");
const { readConversationDeliveryInDatabase } = await import(pathToFileURL(kernelPath).href);
const agentDb = await import(pathToFileURL(agentDbPath).href);
const { openOpenClawAgentDatabase, closeOpenClawAgentDatabasesForTest } = agentDb;

let REDACT = false;
const log = (s = "") => console.log(s);
const load = () => {
  const up = execFileSync("uptime", { encoding: "utf8" }).trim();
  const mp = execFileSync("memory_pressure", ["-Q"], { encoding: "utf8" }).trim().split("\n").pop();
  return `${up} | ${mp}`;
};
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const sha16 = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 16);

log(`arm=${ARM} round=${ROUND} tree=${TREE}`);
log(`import kernel: ${kernelPath}`);
log(`import opener: ${agentDbPath}`);
log(`node ${process.version} sqlite_version ${new DatabaseSync(":memory:").prepare("select sqlite_version() v").get().v}`);
log(`load at start: ${load()}`);

// Spy on StatementSync get/all/iterate (as src/state/sqlite-query-plan.test.ts does) to capture the SQL the lookup runs.
const proto = StatementSync.prototype as any;
function captureLookup(database: any, lookup: any) {
  const captured: Array<{ sql: string; params: unknown[] }> = [];
  const originals: Record<string, any> = {};
  for (const m of ["get", "all", "iterate"]) {
    originals[m] = proto[m];
    proto[m] = function (this: any, ...params: unknown[]) {
      if (/from "conversation_deliveries" /i.test(this.sourceSQL)) captured.push({ sql: this.sourceSQL, params });
      return originals[m].apply(this, params);
    };
  }
  try {
    readConversationDeliveryInDatabase(database, lookup);
  } finally {
    for (const m of ["get", "all", "iterate"]) proto[m] = originals[m];
  }
  return captured;
}

function explain(database: any, lookup: any) {
  const cap = captureLookup(database, lookup);
  if (cap.length !== 1) log(`  WARNING: captured ${cap.length} statements`);
  const c = cap[cap.length - 1];
  const rows = database.db.prepare(`EXPLAIN QUERY PLAN ${c.sql}`).all(...c.params);
  log(`  captured SQL: ${c.sql.replace(/\s+/g, " ")}`);
  log(`  captured params: ${JSON.stringify(REDACT ? ["<conversation id redacted>", ...c.params.slice(1)] : c.params)}`);
  for (const r of rows) log(`  plan: ${r.detail}`);
}

function runCase(database: any, label: string, lookup: any) {
  log(`-- case: ${label}`);
  explain(database, lookup);
  // Correctness pass (untimed): hash every lookup's full returned record.
  const h = createHash("sha256");
  let nonEmpty = 0;
  for (let i = 0; i < LOOKUPS; i++) {
    const rec = readConversationDeliveryInDatabase(database, lookup);
    if (rec) nonEmpty++;
    h.update(JSON.stringify(rec ?? null));
  }
  const hash = h.digest("hex").slice(0, 16);
  for (let w = 0; w < WARMUPS; w++) for (let i = 0; i < LOOKUPS; i++) readConversationDeliveryInDatabase(database, lookup);
  const t: number[] = [];
  for (let s = 0; s < SAMPLES; s++) {
    const t0 = performance.now();
    for (let i = 0; i < LOOKUPS; i++) readConversationDeliveryInDatabase(database, lookup);
    t.push(performance.now() - t0);
  }
  log(`RESULT ${ARM} r${ROUND} | ${label} | ${LOOKUPS} lookups median ${median(t).toFixed(3)} ms [${t.map((x) => x.toFixed(3)).join(", ")}] | records ${nonEmpty}/${LOOKUPS} | hash ${hash}`);
}

function statRows(db: any): number {
  if (!db.prepare("select 1 c from sqlite_master where name = 'sqlite_stat1'").get()) return 0;
  return db.prepare("select count(*) c from sqlite_stat1 where tbl='conversation_deliveries'").get().c;
}
const conv = (i: number) => `conv-${String(i).padStart(3, "0")}`;
function syntheticStatus(i: number) {
  const m = i % 100;
  return m < 55 ? "sent" : m < 70 ? "replied" : m < 80 ? "suppressed" : m < 88 ? "unknown" : m < 95 ? "rejected" : m < 98 ? "created" : "queued";
}
const observedStatus = (i: number) => (i % 666 < 643 ? "sent" : "unknown");

function openFresh(dir: string) {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  process.env.OPENCLAW_STATE_DIR = dir;
  return openOpenClawAgentDatabase({ agentId: "main", env: { OPENCLAW_STATE_DIR: dir } });
}

function seed(database: any, rows: number, convs: number, mix: "synthetic" | "observed") {
  const db = database.db;
  db.exec("BEGIN");
  const ic = db.prepare(
    `INSERT INTO conversations (conversation_id, channel, account_id, kind, peer_id, delivery_target, created_at, updated_at)
     VALUES (?, 'synthetic', 'acct', 'direct', ?, ?, 1, 1)`,
  );
  for (let i = 0; i < convs; i++) ic.run(conv(i), conv(i), conv(i));
  const id = db.prepare(
    `INSERT INTO conversation_deliveries (operation_id, operation_kind, conversation_id, source_session_key, message_hash,
       status, prepared_message_id, platform_message_id, rejection_error, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'h', ?, ?, ?, ?, ?, ?)`,
  );
  for (let i = 0; i < rows; i++) {
    const s = mix === "observed" ? observedStatus(i) : syntheticStatus(i);
    id.run(`op-${i}`, s === "replied" && mix === "synthetic" ? "turn" : "send", conv(i % convs), `synthetic-session-${i % 1000}`, s,
      `prep-${i}`, s === "sent" || s === "replied" ? `msg-${i}` : null, s === "rejected" ? "x" : null, i, i);
  }
  db.exec("COMMIT");
  const turn = db.prepare("select count(*) c from conversation_deliveries where operation_kind='turn'").get().c;
  log(`seeded rows=${rows} conversations=${convs} mix=${mix}; turn rows=${turn}`);
}

function syntheticCases(database: any, withHits: boolean) {
  const db = database.db;
  const cases: Array<[string, any]> = [["miss", { conversationRef: conv(0), replyToId: "msg-absent" }]];
  if (withHits) {
    const turnConv = db.prepare("select conversation_id c from conversation_deliveries where operation_kind='turn' group by conversation_id order by count(*) desc limit 1").get().c;
    const newest = db.prepare("select platform_message_id p from conversation_deliveries where conversation_id=? and operation_kind='turn' order by updated_at desc limit 1").get(turnConv).p;
    const oldest = db.prepare("select platform_message_id p from conversation_deliveries where conversation_id=? and operation_kind='turn' order by updated_at asc limit 1").get(turnConv).p;
    cases.push(["hit, newest turn row", { conversationRef: turnConv, replyToId: newest }], ["hit, oldest turn row", { conversationRef: turnConv, replyToId: oldest }]);
  }
  return cases;
}

function runStore(name: string, title: string, rows: number, convs: number, mix: "synthetic" | "observed", withHits: boolean) {
  log(`\n######## store ${name}: ${title}`);
  const dir = path.join(STATE_ROOT, `${ARM}-r${ROUND}`, name);
  const database = openFresh(dir);
  seed(database, rows, convs, mix);
  const cases = syntheticCases(database, withHits);
  for (const phase of ["no ANALYZE", "after ANALYZE"]) {
    if (phase === "after ANALYZE") database.db.exec("ANALYZE");
    const stat = statRows(database.db);
    log(`\n===== store ${name} / ${phase} (sqlite_stat1 rows for conversation_deliveries: ${stat}) | load: ${load()}`);
    for (const [label, lookup] of cases) runCase(database, label, lookup);
  }
  closeOpenClawAgentDatabasesForTest();
  rmSync(dir, { recursive: true, force: true });
}

function runReal() {
  log(`\n######## store e: real store (APFS-cloned copy of the master backup, opened by the production opener under OPENCLAW_STATE_DIR)`);
  if (!REAL_DB) {
    log("no --real-db given, skipped");
    return;
  }
  const dir = path.join(STATE_ROOT, `${ARM}-r${ROUND}`, "e");
  rmSync(dir, { recursive: true, force: true });
  const target = path.join(dir, "agents/main/agent/openclaw-agent.sqlite");
  mkdirSync(path.dirname(target), { recursive: true });
  execFileSync("cp", ["-c", REAL_DB, target]);
  REDACT = true;
  process.env.OPENCLAW_STATE_DIR = dir;
  const t0 = performance.now();
  let database: any;
  try {
    database = openOpenClawAgentDatabase({ agentId: "main", env: { OPENCLAW_STATE_DIR: dir } });
    log(`opened via openOpenClawAgentDatabase in ${(performance.now() - t0).toFixed(0)} ms`);
  } catch (error: any) {
    const msg = String(error?.message ?? error).replaceAll(dir, "<state>").split(/\n/)[0].slice(0, 160);
    log(`production opener refused the real store (${error?.name}: ${msg}); falling back to a direct node:sqlite open of the cloned file, passed to the production lookup as { db }`);
    database = { db: new DatabaseSync(target) };
  }
  const db = database.db;
  const n = (sql: string) => db.prepare(sql).get().c;
  log(`conversations rows=${n("select count(*) c from conversations")}`);
  log(`conversation_deliveries rows=${n("select count(*) c from conversation_deliveries")}`);
  for (const r of db.prepare("select operation_kind k, status s, count(*) c from conversation_deliveries group by 1, 2 order by 1, 2").all()) {
    log(`  deliveries kind=${r.k} status=${r.s} count=${r.c}`);
  }
  log(`sqlite_stat1 rows for conversation_deliveries=${statRows(db)}`);
  const cases: Array<[string, any]> = [];
  const busiest = db.prepare("select conversation_id c, count(*) n from conversation_deliveries group by 1 order by 2 desc limit 1").get();
  if (busiest) {
    log(`busiest conversation has ${busiest.n} deliveries`);
    cases.push(["miss on busiest conversation", { conversationRef: busiest.c, replyToId: "msg-absent" }]);
  } else {
    const any = db.prepare("select conversation_id c from conversations limit 1").get();
    cases.push(["miss (no deliveries)", { conversationRef: any?.c ?? "conv-absent", replyToId: "msg-absent" }]);
  }
  const hit = db.prepare(
    `select conversation_id c, platform_message_id p from conversation_deliveries
      where operation_kind='turn' and status in ('queued','sent','replied') and platform_message_id is not null
      order by updated_at desc limit 1`).get();
  if (hit) cases.push(["hit, newest eligible turn row", { conversationRef: hit.c, replyToId: hit.p }]);
  else log("no eligible turn rows: hit case skipped");
  log(`\n===== store e / as-is (no ANALYZE issued by harness) | load: ${load()}`);
  for (const [label, lookup] of cases) runCase(database, label, lookup);
  try { database.db.close?.(); } catch {}
  closeOpenClawAgentDatabasesForTest();
  rmSync(dir, { recursive: true, force: true });
}

for (const s of STORES) {
  if (s === "a") runStore("a", "200,000 rows over 50 conversations, synthetic mix with turn rows", 200000, 50, "synthetic", true);
  if (s === "b") runStore("b", "200,000 rows in 1 conversation, synthetic mix with turn rows", 200000, 1, "synthetic", true);
  if (s === "c") runStore("c", "666 rows over 50 conversations, observed mix (643 sent, 23 unknown, no turn rows)", 666, 50, "observed", false);
  if (s === "d") runStore("d", "666 rows in 1 conversation, observed mix (643 sent, 23 unknown, no turn rows)", 666, 1, "observed", false);
  if (s === "e") runReal();
}
log(`\nload at end: ${load()}`);
log("DONE");
