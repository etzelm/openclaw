import { DatabaseSync } from "node:sqlite";
const db = new DatabaseSync(":memory:");
console.log(`sqlite ${db.prepare("select sqlite_version() v").get().v}`);
db.exec("CREATE TABLE t(a, s, x); CREATE INDEX p_eq ON t(a) WHERE s = 'sent'; CREATE INDEX p_in ON t(x) WHERE s IN ('queued','sent','replied');");
const p = (sql, args) => db.prepare("EXPLAIN QUERY PLAN " + sql).all(...args).map(r => r.detail).join(" | ");
console.log("partial WHERE s = 'sent', query a = ? AND s = ? bound 'sent':", p("SELECT * FROM t WHERE a = ? AND s = ?", [1, "sent"]));
console.log("partial WHERE s = 'sent', query a = ? AND s = 'sent' literal:", p("SELECT * FROM t WHERE a = ? AND s = 'sent'", [1]));
console.log("partial WHERE s IN (...), query x = ? AND s IN (?, ?, ?) bound:", p("SELECT * FROM t WHERE x = ? AND s IN (?, ?, ?)", [1, "queued", "sent", "replied"]));
console.log("partial WHERE s IN (...), query x = ? AND s IN (...) literal:", p("SELECT * FROM t WHERE x = ? AND s IN ('queued','sent','replied')", [1]));
