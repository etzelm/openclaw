# Shipped CLI proof: append to a memory file, re-index, search (PR #175608)

Arms: BEFORE = clean clone of base `fe6a3616168bca792650edb0bed09aa0462e6cc6`; AFTER = clean clone of the reviewed PR head `6c4f0e654f4b110709c52ca2615764f6e5328926` (signed; tree `f9a434c87eec58525abafcc6200e8a529afdda42`). Both `pnpm install --frozen-lockfile` and `pnpm build`, exit 0, `git status --porcelain` empty after the build (`build.out`). Mac Studio, macOS 27.0.1 arm64, Node v24.21.0, node:sqlite SQLite 3.53.4. Every command is the built CLI `node <arm>/openclaw.mjs memory ...` in a clean environment (`env -i`, own HOME and `OPENCLAW_STATE_DIR` per run); the full command, stdout, stderr, exit code and wall time of each are in `runs/<run>/logs/`.

Scenario, identical on both arms (`tools/run-arm.sh`): generate `memory/synthetic-notes.md` (100 or 2000 generated paragraphs; paragraph 4 carries `copperwillow`), `openclaw memory index`, snapshot the store, append one generated paragraph carrying `tundrabeacon`, `openclaw memory index` again, snapshot, `openclaw memory search copperwillow`, `openclaw memory search tundrabeacon`, `openclaw memory status`. Configurations: `keyword` (`provider: "none"`), `semantic` (`provider: "openai-compatible"` against a loopback embeddings stub, embedding cache on, the default), `semantic-nocache` (the same with `cache.enabled: false`). sqlite-vec loaded in every semantic run (`memory_index_chunks_vec` present; `memory status` reports `vector.index.state: "complete"`, dims 64), so the semantic runs are a clean semantic index.

Evidence sources: snapshots (`runs/<run>/snap/*.json`, read-only copies of the agent database between commands: per chunk row id prefix, `chunk_rowid`, line range, hash prefix, `updated_at`, embedding length, plus the index revision); the read-only observer (`runs/<run>/obs/<step>.jsonl`, every write statement on a `memory_*` table with rows changed, plus the built module names on the stack for chunk and vector writes); the embeddings stub request log (`runs/<run>/embeddings.jsonl`, one line per HTTP request with the number of inputs). Full table: `summary.out` (`tools/summarize.mjs`).

## Second `memory index` after the append

| Configuration | Arm | Chunks before/after | Earlier rows kept byte-identical (rowid, lines, hash, `updated_at`, embedding length) | Earlier rows given a new `updated_at` | Chunk rows deleted / inserted or upserted | Vector rows deleted / inserted | Recall / provenance upserts | Revision delta | Embedding requests / inputs |
|---|---|---|---|---|---|---|---|---|---|
| keyword, 100 paragraphs | BEFORE | 35/35 | 0 of 34 | 34 | 35 / 35 | none | 35 / 35 | 36 -> 107 (+71) | none |
| | AFTER | 35/35 | 34 of 34 | 0 | 1 / 1 | none | 35 / 35 | 36 -> 39 (+3) | none |
| keyword, 2000 paragraphs | BEFORE | 699/700 | 0 of 699 | 699 | 699 / 700 | none | 700 / 700 | 700 -> 2100 (+1400) | none |
| | AFTER | 699/700 | 699 of 699 | 0 | 0 / 1 | none | 700 / 700 | 700 -> 702 (+2) | none |
| semantic, cache on, 100 paragraphs | BEFORE | 35/35 | 0 of 34 | 34 | 1 / 35 | 35 / 35 | 35 / 35 | 36 -> 73 (+37) | 1 / 1 |
| | AFTER | 35/35 | 34 of 34 | 0 | 1 / 1 | 1 / 1 | 35 / 35 | 36 -> 39 (+3) | 1 / 1 |
| semantic, cache off, 100 paragraphs | BEFORE | 35/35 | 0 of 34 | 34 | 1 / 35 | 35 / 35 | 35 / 35 | 36 -> 73 (+37) | 7 / 35 |
| | AFTER | 35/35 | 34 of 34 | 0 | 1 / 1 | 1 / 1 | 35 / 35 | 36 -> 39 (+3) | 1 / 1 |
| semantic, cache off, 2000 paragraphs | BEFORE | 699/700 | 0 of 699 | 699 | 0 / 700 | 699 / 700 | 700 / 700 | 700 -> 1401 (+701) | 133 / 700 |
| | AFTER | 699/700 | 699 of 699 | 0 | 0 / 1 | 0 / 1 | 700 / 700 | 700 -> 702 (+2) | 1 / 1 |

On 100 paragraphs the append grows the last chunk (one id removed, one new id); on 2000 paragraphs it adds a chunk after an unchanged last chunk (one new id, none removed). The first `memory index` is the same on both arms (35 or 699 chunk rows inserted; in the cache-off runs 7 requests / 35 inputs and 133 / 699).

Reading it:

- Keyword-only (BEFORE takes `clear()`): BEFORE deletes and reinserts every chunk row of the file and every earlier row gets the new `updated_at` (one distinct `updated_at` across the file afterwards). AFTER writes only the new tail chunk; the 34 (699) earlier rows keep `chunk_rowid` and `updated_at`.
- Clean semantic index (vectors complete, BEFORE takes the kernel's vector-reuse path): BEFORE deletes no earlier chunk row but upserts all of them with a new `updated_at` and deletes and rewrites every vector row (35 or 700). With the embedding cache off it sends every chunk to the provider again (35 inputs in 7 requests; 700 inputs in 133 requests). With the cache on (the default) it sends 1 input, the cache answers the rest, and the row and vector rewrites are unchanged. AFTER sends 1 input in 1 request in every semantic run and writes 1 chunk row and 1 vector row.
- Both arms refresh recall metadata and provenance for every chunk (`observed_at` follows the file mtime), as the PR body states.

## Search and status after the append

| Configuration | `memory search copperwillow` (early paragraph) | `memory search tundrabeacon` (appended paragraph) | Same output on both arms (ignoring `observedAt`) | Stored rows equal across arms (ignoring `chunk_rowid`, `updated_at`) |
|---|---|---|---|---|
| keyword, 100 | 1 hit, `memory/synthetic-notes.md:6-14` | 1 hit, `:200-204` | yes / yes | yes |
| keyword, 2000 | 1 hit, `:6-14` | 1 hit, `:4002-4004` | yes / yes | yes |
| semantic, cache on, 100 | 1 hit, `:6-14` | 1 hit, `:200-204` | yes / yes | yes |
| semantic, cache off, 100 | 1 hit, `:6-14` | 1 hit, `:200-204` | yes / yes | yes |
| semantic, cache off, 2000 | 1 hit, `:6-14` | 1 hit, `:4002-4004` | yes / yes | yes |

`copperwillow` is on line 9 and `tundrabeacon` on the last line of the file (the reported range counts the trailing empty line). Each semantic search sends one query embedding request on both arms. `memory status` reports 1 file, 35 (700) chunks, `dirty: false` on both arms. Every CLI command exited 0 in all ten runs.

## Where the writes ran

In every run the chunk and vector writes of the second `memory index` ran on a worker thread (`isMainThread: false`) inside the arm's built `manager-source-index-kernel-<hash>.mjs`, called from `manager-publication.worker-<hash>.mjs` (vector writes through `sqlite-vector-<hash>.mjs`). The kernel chunk hash differs between the arms (`Dl33Ahop` on BEFORE, `CsU5mcWy` on AFTER); `build.out` shows the AFTER dist contains the new planner check and the BEFORE dist the old `sessions`-only gate.

## Not shown

- The embedding provider is a loopback stub (`tools/embed-stub.mjs`, deterministic 64-dimension vectors); a real provider, its latency and its cost were not used. The keyword runs use no provider.
- No Gateway was started; the CLI ran the index in-process (its publication worker included). The file watcher and Gateway-owned sync were not exercised.
- Timing is not measured here (each CLI command includes process start-up, about 3 to 5 s); the timings are the in-process measurements in the PR body.
- WAL bytes are not reported: every CLI process checkpoints on close (`wal=0` after each command in the transcripts).
- An edit at the top of the file (the fallback), a trailing removal, `MEMORY.md` and `USER.md`, and PostgreSQL were not run through the CLI.
