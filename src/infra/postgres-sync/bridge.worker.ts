import { parentPort, workerData, type MessagePort } from "node:worker_threads";
import pg, { type QueryResult } from "pg";
import {
  fingerprintPostgresGeneration,
  inspectPostgresGeneration,
  lockPostgresGeneration,
} from "../../snapshot/postgres-generation.js";
import type { PostgresPoolEndpoint, PostgresPoolSetup, PostgresPoolWorkerData } from "./pool.js";
import type {
  BridgeReply,
  BridgeRequest,
  BridgeWorkerData,
  PostgresErrorData,
} from "./protocol.js";

const { host: serviceHost, peers }: PostgresPoolWorkerData = workerData;
function watchPeer({ port, signal }: PostgresPoolEndpoint) {
  port.on("close", () => {
    const peer = new Int32Array(signal);
    Atomics.store(peer, 1, 1);
    Atomics.notify(peer, 1);
  });
}
peers.forEach(watchPeer);
parentPort?.on("message", (message: { watch: PostgresPoolEndpoint }) => watchPeer(message.watch));

function attachHost(host: MessagePort) {
  const clients = new Set<() => void>();
  host.on("message", (message: PostgresPoolSetup) => {
    if ("host" in message) {
      attachHost(message.host);
    } else {
      attachConnection(message.connection, clients);
    }
  });
  host.on("close", () => {
    for (const close of clients) {
      close();
    }
  });
}

function attachConnection(data: BridgeWorkerData, clients: Set<() => void>) {
  const { port, signal, url, schema, connectTimeoutMs, lockTimeoutMs, statementTimeoutMs } = data;
  const control = new Int32Array(signal);
  let client: pg.Client;
  let connectionError: Error | undefined;
  const close = () => {
    clients.delete(close);
    port.close();
    void client?.end().catch(() => {});
  };
  clients.add(close);
  port.on("close", close);

  function send(reply: BridgeReply) {
    port.postMessage(reply);
    Atomics.store(control, 0, reply.id);
    Atomics.notify(control, 0);
  }

  async function handleRequest(request: BridgeRequest) {
    let reply: BridgeReply;
    try {
      if (request.operation === "connect") {
        if (client && !connectionError) {
          try {
            // Validate only while idle: user statements are never replayed after a lost connection.
            await client.query("SELECT 1");
            reply = {
              id: request.id,
              result: { inTransaction: false, rows: [], rowCount: 0, fields: [] },
            };
            send(reply);
            return;
          } catch (error) {
            connectionError = error instanceof Error ? error : new Error(String(error));
          }
        }
        if (client) {
          await client.end().catch(() => {});
        }
        connectionError = undefined;
        // URL parsing can throw too; every connect failure must wake the waiting host.
        client = new pg.Client({
          connectionString: url,
          connectionTimeoutMillis: connectTimeoutMs,
          types: {
            // Store decoders own JSON parsing, including malformed legacy payload handling.
            getTypeParser: (oid, format) =>
              (oid === pg.types.builtins.JSON || oid === pg.types.builtins.JSONB) &&
              format !== "binary"
                ? (value: string) => value
                : pg.types.getTypeParser(oid, format),
          },
        });
        client.on("error", (error) => {
          connectionError = error;
        });
        await client.connect();
        await client.query(
          "SELECT set_config('lock_timeout', $1, false), " +
            "set_config('statement_timeout', $2, false), set_config('search_path', $3, false)",
          [`${lockTimeoutMs}ms`, `${statementTimeoutMs}ms`, `"${schema.replaceAll('"', '""')}"`],
        );
        reply = {
          id: request.id,
          result: { inTransaction: false, rows: [], rowCount: 0, fields: [] },
        };
      } else if (request.operation === "close") {
        await client.end();
        reply = {
          id: request.id,
          result: { inTransaction: false, rows: [], rowCount: 0, fields: [] },
        };
      } else {
        if (connectionError) {
          throw connectionError;
        }
        if (request.operation === "release") {
          // Server status also catches transactions opened later in a multi-statement query.
          const reusable = client.getTransactionStatus() === "I";
          if (!reusable) {
            await client.end();
          }
          reply = { id: request.id, reusable };
        } else if (request.operation === "recovery-generation") {
          if (request.lock) {
            await lockPostgresGeneration(client, schema);
          }
          const anchor = { namespace: schema, storeId: request.storeId };
          const generation = fingerprintPostgresGeneration(
            anchor,
            await inspectPostgresGeneration(client, anchor),
          );
          reply = { id: request.id, generation };
        } else {
          // exp only: trip instrumentation (OCX_TRIPLOG / OCX_TRIPEXPLAIN); off by default.
          const ocxExplain =
            process.env.OCX_TRIPEXPLAIN === "1"
              ? await ocxExplainQuery(client, request.sql, request.parameters)
              : undefined;
          const ocxStart = performance.now();
          const results = await client.query(request.sql, [...request.parameters]);
          const ocxPgMs = performance.now() - ocxStart;
          const result: QueryResult = Array.isArray(results) ? results.at(-1)! : results;
          // A trailing SELECT must not hide an earlier write in the same SQL batch.
          const commands = (Array.isArray(results) ? results : [results]).map(
            ({ command }) => command,
          );
          const mutation = commands.some((command) =>
            /^(?:CREATE|ALTER|DROP|TRUNCATE|COMMENT|GRANT|REVOKE|COPY|CALL|DO|REFRESH)$/.test(
              command,
            ),
          )
            ? "unscoped"
            : commands.some((command) => /^(?:INSERT|UPDATE|DELETE|MERGE)$/.test(command))
              ? "scoped"
              : undefined;
          reply = {
            id: request.id,
            result: {
              inTransaction: client.getTransactionStatus() !== "I",
              command: result.command,
              mutation,
              rows: result.rows,
              rowCount: result.rowCount ?? 0,
              fields: result.fields.map(({ name, dataTypeID }) => ({ name, dataTypeID })),
            },
          };
          if (process.env.OCX_TRIPLOG) {
            Object.assign(reply, { ocx: { pgMs: ocxPgMs, explain: ocxExplain } });
          }
        }
      }
    } catch (error) {
      const failure = error instanceof Error ? error : new Error(String(error));
      const reported =
        request.operation === "connect"
          ? new Error(
              `PostgreSQL connection failed: ${failure.message}. Check database.postgres.connection, network, and credentials.`,
            )
          : failure;
      if (request.operation === "connect") {
        reported.name = "PostgresConnectionError";
      }
      const details: PostgresErrorData = {
        name: reported.name,
        message: reported.message,
        stack: reported.stack,
      };
      if (
        request.operation === "connect" &&
        "code" in failure &&
        typeof failure.code === "string"
      ) {
        details.code = failure.code;
      }
      if (error instanceof pg.DatabaseError) {
        Object.assign(details, {
          code: error.code,
          detail: error.detail,
          constraint: error.constraint,
          column: error.column,
        });
      }
      reply = { id: request.id, error: details };
    }
    send(reply);
    if (
      request.operation === "close" ||
      (request.operation === "connect" && "error" in reply) ||
      ("reusable" in reply && !reply.reusable)
    ) {
      close();
    }
  }

  port.on("message", (request: BridgeRequest) => {
    void handleRequest(request);
  });
}
attachHost(serviceHost);
parentPort?.postMessage({ poolReady: true }, []);

// exp only: server plan/exec time for one statement, rolled back before the real execution.
async function ocxExplainQuery(
  client: pg.Client,
  sql: string,
  parameters: readonly unknown[],
): Promise<{ planMs?: number; execMs?: number; error?: string } | undefined> {
  const text = sql.trim();
  if (
    /^(?:BEGIN|COMMIT|ROLLBACK|SAVEPOINT|RELEASE|SET|SHOW|START)\b/i.test(text) ||
    /;\s*\S/.test(text) ||
    /^select\s+set_config/i.test(text)
  ) {
    return undefined;
  }
  const inTransaction = client.getTransactionStatus() !== "I";
  await client.query(inTransaction ? "SAVEPOINT ocx_explain" : "BEGIN");
  try {
    const result = await client.query(`EXPLAIN (ANALYZE, FORMAT JSON) ${text}`, [...parameters]);
    const raw = result.rows[0]?.["QUERY PLAN"];
    const plan = typeof raw === "string" ? JSON.parse(raw) : raw;
    return { planMs: plan[0]["Planning Time"], execMs: plan[0]["Execution Time"] };
  } catch (error) {
    return { error: String((error as Error).message).slice(0, 160) };
  } finally {
    if (inTransaction) {
      await client.query("ROLLBACK TO SAVEPOINT ocx_explain");
      await client.query("RELEASE SAVEPOINT ocx_explain");
    } else {
      await client.query("ROLLBACK");
    }
  }
}
