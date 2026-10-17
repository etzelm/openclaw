# t2-02 shipped-entry-point proof (PR #175608): index

What it shows: on a build of the base and a build of the reviewed PR head, the shipped CLI (`openclaw memory index`, `openclaw memory search`, `openclaw memory status`) indexes a synthetic memory file, re-indexes it after a one-paragraph append, and finds both an early and the appended paragraph. Results per arm: `summary.md`. Full table and cross-arm parity: `summary.out`.

## Arms

- BEFORE: `fe6a3616168bca792650edb0bed09aa0462e6cc6` (base of the PR).
- AFTER: `6c4f0e654f4b110709c52ca2615764f6e5328926` (the reviewed, signed PR head; tree `f9a434c87ee`).

Each arm is a fresh clone with `origin` set to `https://github.com/openclaw/openclaw.git`, detached at that commit, then `pnpm install --frozen-lockfile` and `pnpm build`. `build.out` records the heads, an empty `git status --porcelain` after the build, the install and build tails, three dist probes, and the sha256 of the non-test source diff (`d2bbf9d27f37...`, the value in the PR body).

## Reproduce

From a directory holding `base/` and `head/` (built as above) and `tools/`:

```
tools/run-all.sh "$PWD/proofrun"          # both arms, five configurations, alternating arms
node tools/summarize.mjs proofrun/runs > summary.out
```

`tools/run-arm.sh <base|head> <keyword|semantic|semantic-nocache> <paragraphs> <root>` runs one arm and one configuration:

1. writes a per-run `openclaw.json` (copied here as `runs/<run>/openclaw.json`; workspace path scrubbed): memory-core, `memory.search.sources: ["memory"]`, and either `provider: "none"` or `provider: "openai-compatible"` with `remote.baseUrl` on a loopback port served by `tools/embed-stub.mjs` (cache on or off);
2. `tools/gen-synthetic-notes.mjs <workspace> <paragraphs>` writes `memory/synthetic-notes.md` (seeded generated text; digests in `fixture-sha256.txt`);
3. `openclaw memory index --agent main --verbose`, then a read-only snapshot;
4. waits 2 s, appends one generated paragraph, `openclaw memory index --agent main --verbose`, snapshot;
5. `openclaw memory search copperwillow --agent main --json`, `openclaw memory search tundrabeacon --agent main --json`, `openclaw memory status --agent main --json`, snapshot.

Every `openclaw` command goes through `tools/oc.mjs`: `env -i` with only `PATH`, `HOME` (per run), `OPENCLAW_STATE_DIR` (per run), `NODE_OPTIONS=--import=<observer>` and the observer's output path; it runs `node <arm>/openclaw.mjs ...` from the arm's build. No Gateway runs, so the CLI indexes in-process.

## Files

| File | What it is |
|---|---|
| `summary.md` | Per arm and configuration: rows kept and written, `updated_at`, vector rows, recall and provenance upserts, revision delta, embedding requests, search results, parity |
| `summary.out` | Output of `tools/summarize.mjs`: the full table, observer totals per run, cross-arm parity hashes, and the built modules on the stack of every chunk and vector write |
| `build.out` | Heads, clean status, install and build result, dist probes, non-test diff sha256 |
| `run-all.log` | Order of the runs and the 1, 5 and 15 minute load averages at each start |
| `fixture-sha256.txt` | Digests of the generated file before and after the append |
| `runs/<arm>-<configuration>-p<paragraphs>/transcript.txt` | Terminal transcript of the run: each command, its stdout, the embedding request count per step, and the snapshot line after each index |
| `runs/<run>/logs/<step>.{cmd,out,err,exit,ms}` | Exact command line, full stdout, full stderr, exit code and wall ms of each CLI command; `<step>.embseq` is the stub log line range of that step |
| `runs/<run>/obs/<step>.jsonl` | Observer records of that CLI process and its worker threads |
| `runs/<run>/snap/<step>.json` | Snapshot of the memory index after `a-index`, `b-index` and `d-status` |
| `runs/<run>/embeddings.jsonl` | Embedding stub request log (semantic runs only) |
| `runs/<run>/openclaw.json` | Config of the run |
| `screenshots/*.png` | Headless Chrome renderings of six transcripts (keyword 100 and semantic cache-off 100 and 2000, each arm) with the run's summary row; `tools/render-terminal.mjs` makes them. They are renderings of the captured transcript, not live terminal captures |
| `tools/` | Every script used, as run |

Not for publication (internal, kept beside the tree): `PR-BODY.v2.md` (staged PR body with the `<PROOF-URL>` placeholder) and `review-round2.md` (pre-review).

## Instruments (none changes OpenClaw code)

- `tools/observe-memory-writes.mjs`, loaded with `NODE_OPTIONS=--import`, which Node also applies to worker threads (each thread writes an `observer-loaded` line). It wraps `node:sqlite` `prepare` and the returned statement's `run`/`all`/`get`, and `exec`. For every INSERT, UPDATE, DELETE or REPLACE on a table whose name starts with `memory_`, and every SELECT on an embedding cache table, it appends pid, thread, operation, table, rows changed or returned, and the first 160 characters of the SQL. For chunk and vector writes it also records the basenames of the built modules on the stack. It records no parameters and no row contents, and never changes a statement, a parameter or a result.
- `tools/snapshot.mjs` reads a copy of the agent database (database, WAL and SHM copied while no OpenClaw process runs) with `readOnly: true`. Per chunk row it records the first 16 hex digits of the id, `chunk_rowid`, line range, the first 12 hex digits of the text hash, model, `updated_at` and embedding byte length; plus table counts, the index revision (`memory_index_state`), the `memory_index_sources` row and `memory_index_meta`. No chunk text.
- `tools/embed-stub.mjs`, a loopback OpenAI-compatible `/v1/embeddings` server returning deterministic 64-dimension vectors. Per HTTP request it logs sequence, time, path, model, number of inputs, total characters and the first 12 hex digits of each input's sha256. It stands in for the remote embedding service; the keyword runs do not use it.

## Scrubbing

`tools/scrub.mjs` rewrote every text file: the proof work directory becomes `<scratch>`, the home directory `<home>`, the host name `<host>`, loopback address and port `<loopback>:<port>`, temp directories `<tmp>`; the values come from the environment and do not appear in the script. The only literal address left is `127.0.0.1` in `tools/embed-stub.mjs` and `tools/run-arm.sh` (the stub binds loopback). Everything else in the runs is synthetic: the memory file is generated text, ids and hashes come from that text, pids and timestamps are from these runs.
