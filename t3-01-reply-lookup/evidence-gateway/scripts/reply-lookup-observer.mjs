// Read-only observer for the inbound reply-target lookup, loaded into the
// Gateway process with NODE_OPTIONS="--import <this file>". Node applies
// NODE_OPTIONS preloads to every worker thread as well, so the session read
// worker loads it too. It does not change any statement, parameter or result:
// it wraps node:sqlite so that, when the reply-target lookup on
// conversation_deliveries runs, it appends one JSON line with the thread, the
// statement text, the bound parameters, the returned rows, and the output of
// EXPLAIN QUERY PLAN for that same statement and those same parameters on the
// same connection. Writes to conversation_deliveries are logged as statement
// text and parameters only. Not part of the PR.
import { appendFileSync } from "node:fs";
import sqlite from "node:sqlite";
import { isMainThread, threadId } from "node:worker_threads";

const logPath = process.env.T3_REPLY_LOOKUP_OBSERVER_LOG;
const { DatabaseSync, StatementSync } = sqlite;

function isReplyLookup(sql) {
  const text = sql.toLowerCase();
  return (
    text.startsWith("select") &&
    text.includes('"conversation_deliveries"') &&
    text.includes("platform_message_id") &&
    text.includes("prepared_message_id") &&
    text.includes("order by")
  );
}

function isDeliveryWrite(sql) {
  const text = sql.trimStart().toLowerCase();
  return (
    (text.startsWith("insert") || text.startsWith("update")) &&
    text.includes("conversation_deliveries")
  );
}

function callerFrames() {
  // Basenames of the built modules on the stack, so the record shows which
  // shipped chunk ran the statement without leaking local paths.
  // Consecutive repeats are collapsed.
  const previousLimit = Error.stackTraceLimit;
  Error.stackTraceLimit = 200;
  const stack = new Error().stack?.split("\n").slice(3) ?? [];
  Error.stackTraceLimit = previousLimit;
  const names = stack
    .map((line) => line.match(/([^/\\(\s]+\.(?:m?js)):\d+:\d+/)?.[1])
    .filter((name) => name && name !== "reply-lookup-observer.mjs");
  return names.filter((name, index) => name !== names[index - 1]);
}

function write(record) {
  if (!logPath) {
    return;
  }
  appendFileSync(
    logPath,
    `${JSON.stringify({ at: new Date().toISOString(), pid: process.pid, threadId, isMainThread, ...record })}\n`,
  );
}

const watched = new WeakMap();
const originalPrepare = DatabaseSync.prototype.prepare;
DatabaseSync.prototype.prepare = function prepare(sql, ...rest) {
  const statement = originalPrepare.call(this, sql, ...rest);
  if (typeof sql === "string") {
    if (isReplyLookup(sql)) {
      watched.set(statement, { db: this, kind: "reply-lookup" });
    } else if (isDeliveryWrite(sql)) {
      watched.set(statement, { db: this, kind: "delivery-write" });
    }
  }
  return statement;
};

function summarizeRow(row) {
  if (!row || typeof row !== "object") {
    return row;
  }
  const keep = [
    "operation_id",
    "operation_kind",
    "status",
    "conversation_id",
    "platform_message_id",
    "prepared_message_id",
    "updated_at",
  ];
  return Object.fromEntries(keep.filter((key) => key in row).map((key) => [key, row[key]]));
}

for (const method of ["all", "get", "run"]) {
  const original = StatementSync.prototype[method];
  StatementSync.prototype[method] = function observed(...args) {
    const info = watched.get(this);
    if (!info) {
      return original.apply(this, args);
    }
    const startedAt = process.hrtime.bigint();
    const result = original.apply(this, args);
    const elapsedUs = Number(process.hrtime.bigint() - startedAt) / 1000;
    if (info.kind === "delivery-write") {
      write({ event: "delivery-write", method, sql: this.sourceSQL, params: args });
      return result;
    }
    const rows = method === "all" ? result : result === undefined ? [] : [result];
    let plan;
    try {
      plan = originalPrepare
        .call(info.db, `EXPLAIN QUERY PLAN ${this.sourceSQL}`)
        .all(...args)
        .map((row) => row.detail);
    } catch (error) {
      plan = [`EXPLAIN failed: ${String(error)}`];
    }
    write({
      event: "reply-lookup",
      method,
      sql: this.sourceSQL,
      params: args,
      rowCount: rows.length,
      rows: rows.map(summarizeRow),
      statementMicros: Math.round(elapsedUs),
      plan,
      frames: callerFrames(),
    });
    return result;
  };
}

write({ event: "observer-loaded" });
