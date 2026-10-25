import { describe, expect, it, vi } from "vitest";
import type { PostgresSqlConnection } from "../sql-connection.js";
import { DatabaseSearchCapabilityUnavailableError } from "./capability-unavailable.js";
import { admitPostgresSearch } from "./postgres-search-schema.js";
import type { SearchSchema } from "./search.js";

vi.mock("../sqlite-database-admission.js", () => ({
  getSqliteDatabaseAdmission: () => undefined,
  publishSqliteDatabaseAdmission: () => undefined,
}));

const search: SearchSchema = {
  text: {
    notes: { table: "notes", fields: ["text"], postgres: { identity: "id", mode: "trigram" } },
  },
};

function connection(installed: Record<string, unknown>[], available: Record<string, unknown>[]) {
  const statements: string[] = [];
  const db = {
    prepare(sql: string) {
      statements.push(sql);
      return {
        all: () => (sql.includes("pg_available_extensions") ? available : installed),
        get: () => ({ allowed: 1 }),
      };
    },
  };
  return { db: db as unknown as PostgresSqlConnection, statements };
}

describe("PostgreSQL search extension admission", () => {
  it("reads installed extensions from the catalog without scanning the extension directory", () => {
    const { db, statements } = connection(
      [
        { name: "unaccent", extname: "unaccent", extversion: "1.1", nspname: "public" },
        { name: "pg_trgm", extname: "pg_trgm", extversion: "1.6", nspname: "public" },
      ],
      [],
    );
    admitPostgresSearch(db, search, "store");
    expect(statements.some((sql) => sql.includes("pg_available_extensions"))).toBe(false);
  });

  it("names a missing extension from the available-extension listing", () => {
    const { db, statements } = connection(
      [{ name: "unaccent", extname: "unaccent", extversion: "1.1", nspname: "public" }],
      [
        { name: "unaccent", extname: "unaccent", extversion: "1.1", nspname: "public" },
        { name: "pg_trgm", extname: null, extversion: null, nspname: null },
      ],
    );
    expect(() => admitPostgresSearch(db, search, "store")).toThrow(
      DatabaseSearchCapabilityUnavailableError,
    );
    expect(statements.filter((sql) => sql.includes("pg_available_extensions"))).toHaveLength(1);
    expect(() => admitPostgresSearch(db, search, "store")).toThrow(
      /pg_trgm capability unavailable.*Have a database administrator run: CREATE EXTENSION/,
    );
  });

  it("still refuses an extension installed outside the configured schema", () => {
    const { db } = connection(
      [
        { name: "unaccent", extname: "unaccent", extversion: "1.1", nspname: "other" },
        { name: "pg_trgm", extname: "pg_trgm", extversion: "1.6", nspname: "public" },
      ],
      [],
    );
    expect(() => admitPostgresSearch(db, search, "store")).toThrow(
      /unaccent capability unavailable.*Configure the store's extensionSchema as other/,
    );
  });
});
