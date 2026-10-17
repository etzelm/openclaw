#!/usr/bin/env node
// Read-only snapshot of the memory index of one agent database (a copy taken while no
// OpenClaw process runs). usage: node snapshot.mjs <db-copy> <out.json>
// Records per chunk row: id (first 16 hex), chunk_rowid, line range, hash (first 12),
// updated_at, embedding byte length; plus table counts, the index revision, the
// memory_index_sources rows (path, hash prefix, size) and the embedding cache row count.
// Chunk text is not recorded.
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";

const [, , dbPath, outPath] = process.argv;
const db = new DatabaseSync(dbPath, { readOnly: true });
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type IN ('table') AND name LIKE 'memory%' ORDER BY name").all().map((r) => r.name);
const counts = {};
for (const t of tables) {
  try { counts[t] = db.prepare(`SELECT COUNT(*) c FROM "${t}"`).get().c; } catch (e) { counts[t] = `ERR ${e.message}`; }
}
let revision = null;
try { revision = db.prepare("SELECT revision FROM memory_index_state WHERE id = 1").get()?.revision ?? null; } catch {}
const sources = db.prepare("SELECT path, source, substr(hash,1,12) hash, size FROM memory_index_sources ORDER BY path").all().map((r) => ({ ...r }));
const chunks = db.prepare(`SELECT substr(id,1,16) id, chunk_rowid, path, start_line, end_line, substr(hash,1,12) hash,
  model, updated_at, length(embedding) embedding_bytes FROM memory_index_chunks ORDER BY start_line, id`).all().map((r) => ({ ...r }));
const meta = {};
try { for (const r of db.prepare("SELECT key, substr(value,1,80) value FROM memory_index_meta ORDER BY key").all()) meta[r.key] = r.value; } catch {}
fs.writeFileSync(outPath, `${JSON.stringify({ counts, revision, sources, meta, chunks }, null, 1)}\n`);
console.log(JSON.stringify({ tables: tables.length, chunks: chunks.length, revision, sources: sources.length }));
