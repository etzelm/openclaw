#!/usr/bin/env node
// Read-only parity snapshot of an agent DB copy (copied while no OpenClaw process runs).
// usage: node snapshot-parity.mjs <db-copy> <out.json> [--counts-only] [--since-ms N]
// Records counts, byte lengths and sha256 hashes only: no chunk text, no paths, no ids, no session ids.
//  hashes: memory_index_chunks (id, embedding) by id; memory_embedding_cache (provider, model, provider_key, hash, embedding)
//  ordered; every memory_index_chunks_vec* shadow table in rowid order; a rowid-independent join of the
//  vec0 rows (id from *_vec_rowids, vector bytes from *_vec_vector_chunks00 at chunk_offset) by id.
//  --since-ms splits the chunk hash into rows with updated_at >= N ("new") and the rest ("old").
import crypto from "node:crypto";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";

const args = process.argv.slice(2);
const [dbPath, outPath] = args;
const countsOnly = args.includes("--counts-only");
const sinceIdx = args.indexOf("--since-ms");
const since = sinceIdx >= 0 ? Number(args[sinceIdx + 1]) : null;
const db = new DatabaseSync(dbPath, { readOnly: true });
const one = (sql) => db.prepare(sql).get();
const all = (sql) => db.prepare(sql).all();
const res = { counts: {}, dims: {}, hashes: {} };
const tables = all("select name from sqlite_master where type='table' and name like 'memory%' order by name").map((r) => r.name);
for (const t of tables) { try { res.counts[t] = one(`select count(*) c from "${t}"`).c; } catch { res.counts[t] = "virtual-or-unreadable"; } }
res.sources = all("select source, count(*) n from memory_index_chunks group by source order by source").map((r) => ({ ...r }));
res.embeddingBytes = all("select length(embedding) bytes, count(*) n from memory_index_chunks group by 1").map((r) => ({ ...r }));
res.cacheBytes = all("select provider, model, length(embedding) bytes, dims, count(*) n from memory_embedding_cache group by 1,2,3,4").map((r) => ({ ...r }));
res.revision = one("select revision from memory_index_state where id=1")?.revision ?? null;
if (!countsOnly) {
  const feed = (h, v) => {
    if (v === null || v === undefined) h.update("N;");
    else if (typeof v === "string") { const b = Buffer.from(v); h.update(`S${b.length}:`).update(b); }
    else if (typeof v === "bigint" || typeof v === "number") h.update(`I${v};`);
    else { const b = Buffer.from(v.buffer, v.byteOffset, v.byteLength); h.update(`B${b.length}:`).update(b); }
  };
  const hashQuery = (sql) => {
    const h = crypto.createHash("sha256"); let n = 0;
    for (const row of db.prepare(sql).iterate()) { for (const v of Object.values(row)) feed(h, v); h.update("|"); n++; }
    return { rows: n, sha256: h.digest("hex") };
  };
  res.hashes.chunks_id_embedding = hashQuery("select id, embedding from memory_index_chunks order by id");
  if (since !== null) {
    res.hashes.chunks_new = hashQuery(`select id, embedding from memory_index_chunks where updated_at >= ${since} order by id`);
    res.hashes.chunks_old = hashQuery(`select id, embedding from memory_index_chunks where updated_at < ${since} order by id`);
  }
  res.hashes.embedding_cache = hashQuery("select provider, model, provider_key, hash, embedding from memory_embedding_cache order by provider, model, provider_key, hash");
  res.hashes.embedding_cache_no_provider_key = hashQuery("select provider, model, hash, embedding from memory_embedding_cache order by provider, model, hash");
  res.hashes.vec_shadow = {};
  for (const t of all("select name from sqlite_master where type='table' and name like 'memory_index_chunks_vec_%' order by name").map((r) => r.name)) {
    try { res.hashes.vec_shadow[t] = hashQuery(`select * from "${t}" order by rowid`); } catch (e) { res.hashes.vec_shadow[t] = { error: String(e.message).slice(0, 80) }; }
  }
  // rowid-independent vec0 join: vector bytes keyed by id
  try {
    const DIMS = 4096, VB = DIMS * 4;
    const h = crypto.createHash("sha256"); let n = 0, match = { f32: 0, f64asF32: 0, none: 0 };
    const vecBlobs = new Map();
    for (const r of db.prepare("select rowid, vectors from memory_index_chunks_vec_vector_chunks00").iterate()) vecBlobs.set(Number(r.rowid), r.vectors);
    const chunkEmb = db.prepare("select embedding from memory_index_chunks where id = ?");
    for (const r of db.prepare("select id, chunk_id, chunk_offset from memory_index_chunks_vec_rowids order by id").iterate()) {
      const blob = vecBlobs.get(Number(r.chunk_id));
      const vec = blob ? Buffer.from(blob.buffer, blob.byteOffset + Number(r.chunk_offset) * VB, VB) : Buffer.alloc(0);
      feed(h, r.id); feed(h, vec); h.update("|"); n++;
      const e = chunkEmb.get(r.id)?.embedding;
      if (e && vec.length === VB) {
        const eb = Buffer.from(e.buffer, e.byteOffset, e.byteLength);
        if (eb.length === VB && eb.equals(vec)) match.f32++;
        else if (eb.length === VB * 2 && Buffer.from(new Float32Array(new Float64Array(eb.buffer.slice(eb.byteOffset, eb.byteOffset + eb.length)))).equals(vec)) match.f64asF32++;
        else match.none++;
      } else match.none++;
    }
    res.hashes.vec_by_id = { rows: n, sha256: h.digest("hex"), chunkEmbeddingEqualsVec: match };
  } catch (e) { res.hashes.vec_by_id = { error: String(e.message).slice(0, 120) }; }
}
fs.writeFileSync(outPath, `${JSON.stringify(res, null, 1)}\n`);
console.log(JSON.stringify({ chunks: res.counts.memory_index_chunks, cache: res.counts.memory_embedding_cache, vecRowids: res.counts.memory_index_chunks_vec_rowids, revision: res.revision }));
