// measure-delta.mjs: BEFORE/AFTER harness for the memory-file delta publication change.
//
// USAGE (run from the worktree root of ONE arm, same script for both arms):
//   cd <worktree> && node --import ./scripts/tsx.mjs measure-delta.mjs \
//     --root <worktree> --arm BEFORE|AFTER --round N \
//     --store <sqlite copy on local disk> --store-label "agent store A (430,518,272 bytes)" \
//     --sizes medium,large --modes keyword,semantic [--runs 5 --warmups 2 --shapes S1,S2,S3,S4,S5]
//
// METHOD
//   Code under test is each arm's own production SOURCE, loaded through the repo TS loader
//   (scripts/tsx.mjs). The memory-core internals (prepareMemoryIndexChunks, retainIndexedSessionChunks,
//   memoryPublicationHeader/memoryPublicationBatches, MemorySourceIndexKernel, readMemorySourceChunks)
//   are not standalone modules in dist (bundled chunks), so dist import was not an option.
//   The two arms differ only by the pr.diff.
//   Per publication, inside one BEGIN IMMEDIATE on a node:sqlite connection to a local copy of an agent
//   store (WAL, foreign_keys ON, synchronous NORMAL, busy_timeout 5000, wal_autocheckpoint 0, as the
//   production agent DB open path configures them):
//     1. prepareMemoryIndexChunks on synthetic content (production defaults tokens=400 overlap=80), done
//        once per file version, outside the timed window.
//     2. retainIndexedSessionChunks(prepared, database, generation, assertCurrent) with a thin adapter
//        that exposes isShadow:false and read({type:"source.chunks"}) -> readMemorySourceChunks.
//     3. replacement shaped like manager-embedding-ops sourceReplacement (retained/removedIds copied
//        from the prepared entry; BEFORE's planner returns memory early so they are absent there).
//     4. memoryPublicationHeader(replacement) and rows decoded from memoryPublicationBatches fragments
//        (decoder copied from manager-publication.worker.ts readPublicationRows, which is not exported:
//        join fragment.json until fragment.last, JSON.parse).
//     5. new MemorySourceIndexKernel(db, state).replaceRows(header, rows); state as the worker builds it
//        for SQLite without sqlite-vec: vector {enabled:false, available:false}, fts {enabled,available},
//        hasVectorTable:false.
//   NOT in the loop: embedding provider, worker-thread transport, file watcher, FTS admission/schema
//   admission (the copied store already carries the schema).
//   Timing = steps 2-5, median of --runs after --warmups, each inside BEGIN IMMEDIATE ... ROLLBACK from
//   the committed v1 state. Row work, WAL frames and parity hashes come from one committed run.
//   Semantic mode: deterministic synthetic 1024-dim vectors, model "synthetic-embed-1024",
//   vectorReady=false, and the publication leaves memory_vector_rebuild_v1='1' (rebuild debt, so
//   BEFORE takes clear()). Keyword mode: model "fts-only", empty embeddings.
//   Fixtures are synthetic generated text only. Output: one JSON record per line plus a header.

import { createHash } from "node:crypto";
import { statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { loadavg } from "node:os";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";

const args = Object.fromEntries(
  process.argv
    .slice(2)
    .reduce((acc, token, index, all) => {
      if (token.startsWith("--")) {
        acc.push([token.slice(2), all[index + 1] && !all[index + 1].startsWith("--") ? all[index + 1] : "1"]);
      }
      return acc;
    }, []),
);
const ROOT = args.root;
const ARM = args.arm;
const ROUND = args.round ?? "1";
const STORE = args.store;
const LABEL = args["store-label"] ?? "store";
const SIZES = (args.sizes ?? "medium,large").split(",");
const MODES = (args.modes ?? "keyword").split(",");
const SHAPES = (args.shapes ?? "S1,S2,S3,S4,S5").split(",");
const RUNS = Number(args.runs ?? 5);
const WARMUPS = Number(args.warmups ?? 2);
const TARGETS = { medium: 19, large: 678 };
const CHUNKING = { tokens: 400, overlap: 80 };
const DIMS = 1024;
const SEMANTIC_MODEL = "synthetic-embed-1024";
const V1_MTIME = 1_700_000_000_000;
const V2_MTIME = 1_700_000_100_000;

const load = (rel) => import(pathToFileURL(`${ROOT}/extensions/memory-core/src/memory/${rel}`).href);
const { prepareMemoryIndexChunks } = await load("manager-index-preparation.ts");
const { retainIndexedSessionChunks } = await load("manager-session-delta.ts");
const { memoryPublicationHeader, memoryPublicationBatches } = await load("manager-publication-transfer.ts");
const { MemorySourceIndexKernel, readMemorySourceChunks } = await load("manager-source-index-kernel.ts");

// ---------- synthetic fixtures ----------
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const WORDS = (
  "alder basalt cobalt dune ember fjord glacier harbor iris juniper kelp lagoon meadow nectar orchid pebble " +
  "quartz ridge summit tundra umber valley willow xenon yarrow zephyr amber birch cedar delta elm fern grove " +
  "heron isle jade knoll lichen moss north oak pine quill reed sage thorn upland vine wren yew zinc"
).split(" ");
function paragraph(prefix, i, edited = false) {
  const rand = mulberry32(i * 7919 + 13);
  const lines = [];
  for (let l = 0; l < 3; l++) {
    const words = [];
    for (let w = 0; w < 14; w++) {
      words.push(WORDS[Math.floor(rand() * WORDS.length)]);
    }
    if (l === 0) {
      words.unshift(`${prefix}${i}`);
    }
    lines.push(words.join(" "));
  }
  if (edited) {
    lines[2] = lines[2].replace(/^(\S+) (\S+)/u, "$1 edited");
  }
  return lines.join("\n");
}
const fileOf = (paras, preface) =>
  `# Notes\n${preface ? `${preface}\n` : ""}\n${paras.join("\n\n")}\n`;

const pathOf = { medium: "memory/synthetic-medium.md", large: "memory/synthetic-large.md" };
const prefixOf = { medium: "zqmed", large: "zqlrg" };
const pathClassification = { curatedRoot: false, originClass: "owner" };

function prepare(size, content, mtimeMs, semantic) {
  const entry = { path: pathOf[size], mtimeMs };
  const out = prepareMemoryIndexChunks({
    entry,
    source: "memory",
    content,
    pathClassification,
    chunking: CHUNKING,
    provider: semantic ? { id: "synthetic", maxInputTokens: 8192 } : undefined,
    hardMaxInputTokens: 8192,
  });
  return {
    entry: {
      path: pathOf[size],
      hash: out.contentHash,
      mtimeMs,
      size: Buffer.byteLength(content),
    },
    chunks: out.chunks,
  };
}

function calibrate(size) {
  const target = TARGETS[size];
  const count = (n) => {
    const paras = Array.from({ length: n }, (_, i) => paragraph(prefixOf[size], i));
    return prepare(size, fileOf(paras), V1_MTIME, false).chunks.length;
  };
  let lo = 1;
  let hi = 4;
  while (count(hi) < target) {
    lo = hi;
    hi *= 2;
  }
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (count(mid) < target) lo = mid;
    else hi = mid;
  }
  return { paras: hi, chunks: count(hi) };
}

function versions(size, n) {
  const p = (i, e) => paragraph(prefixOf[size], i, e);
  const base = Array.from({ length: n }, (_, i) => p(i));
  return {
    v1: fileOf(base),
    S1: fileOf([...base, p(n)]),
    S2: fileOf([...base.slice(0, -1), p(n - 1, true)]),
    S3: fileOf(base.slice(0, -1)),
    S4: fileOf(base, "Inserted preface line."),
  };
}

// ---------- store helpers ----------
const sha = (rows) => createHash("sha256").update(JSON.stringify(rows)).digest("hex");
function openStore() {
  const db = new DatabaseSync(STORE);
  db.exec("PRAGMA busy_timeout = 5000;");
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA synchronous = NORMAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec("PRAGMA wal_autocheckpoint = 0;");
  return db;
}
const STATE = {
  vector: { enabled: false, available: false },
  fts: { enabled: true, available: true },
  hasVectorTable: false,
};
function synthVector(hash) {
  const rand = mulberry32(parseInt(hash.slice(0, 8), 16));
  return Array.from({ length: DIMS }, () => Math.fround(rand() * 2 - 1));
}
function readRows(parts) {
  // copy of readPublicationRows in manager-publication.worker.ts
  return (function* () {
    let pieces = [];
    for (const fragment of parts) {
      pieces.push(fragment.json);
      if (fragment.last) {
        yield JSON.parse(pieces.join(""));
        pieces = [];
      }
    }
    if (pieces.length) yield JSON.parse(pieces.join(""));
  })();
}

async function publish(db, size, prepared, semantic, report) {
  const generation = semantic
    ? { kind: "semantic", provider: { id: "synthetic", model: SEMANTIC_MODEL } }
    : { kind: "fts-only", provider: null };
  const database = {
    isShadow: false,
    read: async (command) => readMemorySourceChunks(db, command.input.source, command.input.path),
  };
  // step 2
  const planned = await retainIndexedSessionChunks(
    { entry: prepared.entry, source: "memory", chunks: prepared.chunks },
    database,
    generation,
    () => {},
  );
  if (report) {
    report.plan = {
      incremental: planned.removedIds !== undefined,
      written: planned.chunks.length,
      retained: planned.retained?.length ?? 0,
      removed: planned.removedIds?.length ?? 0,
      prepared_chunks: prepared.chunks.length,
    };
  }
  // step 3
  const replacement = {
    entry: prepared.entry,
    chunks: planned.chunks,
    embeddings: planned.chunks.map((chunk) => (semantic ? synthVector(chunk.hash) : [])),
    model: semantic ? SEMANTIC_MODEL : "fts-only",
    now: prepared.entry.mtimeMs + 1_000_000_000,
    vectorReady: false,
    retained: planned.retained,
    removedIds: planned.removedIds,
    source: "memory",
  };
  // step 4
  const header = memoryPublicationHeader(replacement);
  const fragments = [];
  for (const batch of memoryPublicationBatches(replacement)) fragments.push(...batch);
  const rows = readRows(fragments);
  // step 5
  new MemorySourceIndexKernel(db, STATE).replaceRows(header, rows);
}
function deleteFixture(db, size, hash) {
  return new MemorySourceIndexKernel(db, STATE).deleteIfCurrent({
    path: pathOf[size],
    source: "memory",
    expectedHash: hash,
  });
}

async function inTransaction(db, fn, commit) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = await fn();
    db.exec(commit ? "COMMIT" : "ROLLBACK");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function clearFixture(db, size) {
  // Remove any residue from an earlier run of this harness (synthetic path only).
  db.exec("BEGIN IMMEDIATE");
  db.prepare("DELETE FROM memory_index_chunks WHERE path = ? AND source = 'memory'").run(pathOf[size]);
  db.prepare("DELETE FROM memory_index_sources WHERE path = ? AND source = 'memory'").run(pathOf[size]);
  db.exec("COMMIT");
}

function stateRow(db) {
  return db.prepare("SELECT * FROM memory_index_state").all();
}
function revisionDelta(before, after) {
  const out = {};
  for (const key of Object.keys(after[0] ?? {})) {
    if (typeof after[0][key] === "number" && typeof before[0]?.[key] === "number") {
      out[key] = after[0][key] - before[0][key];
    }
  }
  return out;
}

const TRIGGER_TABLES = [
  ["chunks", "memory_index_chunks"],
  ["recall", "memory_index_chunk_recall_metadata"],
  ["provenance", "memory_index_chunk_provenance"],
  ["fts_docsize", "memory_index_chunks_fts_docsize"],
];
function installOpTriggers(db) {
  db.exec("DROP TABLE IF EXISTS temp.ops");
  db.exec("CREATE TEMP TABLE ops (t TEXT, o TEXT)");
  const active = [];
  for (const [label, table] of TRIGGER_TABLES) {
    try {
      for (const [op, name] of [["INSERT", "ins"], ["UPDATE", "upd"], ["DELETE", "del"]]) {
        db.exec(
          `CREATE TEMP TRIGGER op_${label}_${name} AFTER ${op} ON main.${table} BEGIN INSERT INTO ops VALUES ('${label}', '${name}'); END;`,
        );
      }
      active.push(label);
    } catch {
      // virtual or shadow tables may refuse triggers; report as unavailable
    }
  }
  return active;
}
function readOps(db) {
  const out = {};
  for (const row of db.prepare("SELECT t, o, count(*) AS c FROM ops GROUP BY t, o").all()) {
    (out[row.t] ??= { ins: 0, upd: 0, del: 0 })[row.o] = row.c;
  }
  return out;
}
function dropOpTriggers(db) {
  for (const [label] of TRIGGER_TABLES) {
    for (const name of ["ins", "upd", "del"]) db.exec(`DROP TRIGGER IF EXISTS temp.op_${label}_${name}`);
  }
  db.exec("DROP TABLE IF EXISTS temp.ops");
}

function parity(db, size) {
  const path = pathOf[size];
  const ids = db.prepare("SELECT id, chunk_rowid FROM memory_index_chunks WHERE path = ? AND source = 'memory' ORDER BY id").all(path);
  const chunks = db
    .prepare(
      `SELECT id, path, source, start_line, end_line, hash, model, text, hex(embedding) AS embedding
       FROM memory_index_chunks WHERE path = ? AND source = 'memory' ORDER BY id`,
    )
    .all(path);
  const fts = db
    .prepare(
      `SELECT id, path, source, model, start_line, end_line, text FROM memory_index_chunks_fts
       WHERE rowid IN (SELECT chunk_rowid FROM memory_index_chunks WHERE path = ? AND source = 'memory') ORDER BY id`,
    )
    .all(path);
  const recall = db
    .prepare(
      `SELECT chunk_id, importance, triggers, project_key FROM memory_index_chunk_recall_metadata
       WHERE chunk_id IN (SELECT id FROM memory_index_chunks WHERE path = ? AND source = 'memory') ORDER BY chunk_id`,
    )
    .all(path);
  const provenance = db
    .prepare(
      `SELECT chunk_id, origin_class, session_kind, observed_at, supersedes_key FROM memory_index_chunk_provenance
       WHERE chunk_id IN (SELECT id FROM memory_index_chunks WHERE path = ? AND source = 'memory') ORDER BY chunk_id`,
    )
    .all(path);
  const sources = db.prepare("SELECT path, source, hash, mtime, size FROM memory_index_sources WHERE path = ? AND source = 'memory'").all(path);
  const tokens = [`${prefixOf[size]}1`, `${prefixOf[size]}5`, `${prefixOf[size]}9`];
  const search = tokens.map((token) =>
    db
      .prepare(
        "SELECT id, bm25(memory_index_chunks_fts) AS score FROM memory_index_chunks_fts WHERE memory_index_chunks_fts MATCH ? ORDER BY 2, id",
      )
      .all(`"${token}"`),
  );
  const dedupe = (rows) => rows.map((r) => ({ ...r }));
  return {
    n_chunks: ids.length,
    n_fts: fts.length,
    chunks: sha(dedupe(chunks)),
    fts: sha(dedupe(fts)),
    recall: sha(dedupe(recall)),
    provenance: sha(dedupe(provenance)),
    sources: sha(dedupe(sources)),
    search: sha(search.map(dedupe)),
    search_hits: search.map((rows) => rows.length),
  };
}

const median = (xs) => {
  const sorted = [...xs].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};
const round3 = (x) => Math.round(x * 1000) / 1000;

// ---------- main ----------
const db = openStore();
const pageSize = db.prepare("PRAGMA page_size").get().page_size;
const gitHead = execFileSync("git", ["-C", ROOT, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const gitDirty = execFileSync("git", ["-C", ROOT, "status", "--short"], { encoding: "utf8" }).split("\n").filter(Boolean).length;
const sqliteVersion = db.prepare("select sqlite_version() v").get().v;
console.log(
  `# measure-delta ${ARM} round ${ROUND} | ${LABEL} | method: arm's own production SOURCE via scripts/tsx.mjs loader | ` +
    `chunking tokens=${CHUNKING.tokens} overlap=${CHUNKING.overlap} | node ${process.version} | head=${gitHead} | dirty=${gitDirty} | sqlite=${sqliteVersion} | page_size ${pageSize} | ` +
    `runs=${RUNS} warmups=${WARMUPS} | loadavg ${loadavg().map((x) => x.toFixed(1)).join("/")} | not in loop: embedding provider, worker transport, file watcher, schema/FTS admission`,
);

for (const mode of MODES) {
  const semantic = mode === "semantic";
  for (const size of SIZES) {
    const cal = calibrate(size);
    const v = versions(size, cal.paras);
    console.log(`# fixture ${size}: paragraphs=${cal.paras} chunks(v1)=${cal.chunks} mode=${mode}`);
    clearFixture(db, size);
    const v1 = prepare(size, v.v1, V1_MTIME, semantic);
    const setup = async () => {
      await inTransaction(db, async () => {
        const current = db
          .prepare("SELECT hash FROM memory_index_sources WHERE path = ? AND source = 'memory'")
          .get(pathOf[size]);
        if (current) deleteFixture(db, size, current.hash);
        await publish(db, size, v1, semantic);
      }, true);
      db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    };
    await setup();
    for (const shape of SHAPES) {
      const v2 = shape === "S5" ? undefined : prepare(size, v[shape], V2_MTIME, semantic);
      const step = async () => {
        if (shape === "S5") return deleteFixture(db, size, v1.entry.hash);
        return publish(db, size, v2, semantic);
      };
      const timings = [];
      for (let run = 0; run < WARMUPS + RUNS; run++) {
        db.exec("BEGIN IMMEDIATE");
        const t0 = performance.now();
        await step();
        const t1 = performance.now();
        db.exec("ROLLBACK");
        timings.push(round3(t1 - t0));
      }
      const warm = timings.slice(0, WARMUPS);
      const measured = timings.slice(WARMUPS);

      // committed run
      db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
      const stateBefore = stateRow(db);
      const activeTriggers = installOpTriggers(db);
      const report = {};
      db.exec("BEGIN IMMEDIATE");
      if (shape === "S5") await step();
      else await publish(db, size, v2, semantic, report);
      db.exec("COMMIT");
      const ops = readOps(db);
      dropOpTriggers(db);
      const ckpt = db.prepare("PRAGMA wal_checkpoint(PASSIVE)").get();
      const stateAfter = stateRow(db);
      const par = parity(db, size);
      console.log(
        JSON.stringify({
          store: LABEL,
          arm: ARM,
          round: ROUND,
          size,
          chunks_v1: cal.chunks,
          mode,
          shape,
          warmup_ms: warm,
          runs_ms: measured,
          median_ms: round3(median(measured)),
          plan: report.plan ?? null,
          row_ops: ops,
          op_triggers_active: activeTriggers,
          revision_delta: revisionDelta(stateBefore, stateAfter),
          wal: { frames: ckpt.log, bytes: ckpt.log * pageSize },
          v2_chunks: par.n_chunks,
          parity: par,
        }),
      );
      // restore v1
      await setup();
    }
    clearFixture(db, size);
  }
}
db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
db.close();
console.log(`# done ${ARM} round ${ROUND} ${LABEL}`);
void statSync;
