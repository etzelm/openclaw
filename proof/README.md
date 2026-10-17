# Real behavior proof for openclaw PR #175555 (shipped CLI and Gateway)

PR head `d27f9cb3eb7fb0011baf4d26610a2a4ca59fe8a1` (PATCHED), base `d4d2c3dd1e3e29b7bd19914e3c9c47d40c5dde77` (BASE). No code change was made for this proof.

## Environment

- Mac Studio, macOS 27.0.1 (26A434), arm64; Node v24.21.0; SQLite 3.53.4 from `node:sqlite`; pnpm 12.11.1 (`build.out`, `synthetic/env.out`).
- Arms: clean `git clone` of the repo per arm, `git checkout --detach <sha>`, `git status --porcelain` empty, `pnpm install --frozen-lockfile`, `pnpm build` (exit 0 for both, `build.out`). The built statement differs only by `_docsize` (`dist-frames.out`).
- Paths in every file are rewritten by pure substitution: the scratch root is `<scratch>`, other home paths `<home>`, the machine name `<host>` (see `synthetic/scrub.md`, `gateway/scrub.md`, `redaction-check.out`).

## Commands

All commands ran as `env -i PATH=... HOME=<arm home> OPENCLAW_STATE_DIR=<arm state> OPENCLAW_LOG_LEVEL=trace node <clone>/openclaw.mjs <args>`; the exact command line of every step is in its `*.cmd` file. With the observer, `NODE_OPTIONS=--import=file://<scratch>/tools/observe-reconcile-count.mjs` and `T102_OBSERVE_OUT=<jsonl>` were added.

Synthetic store, per arm (`synthetic/<arm>/logs/`, `synthetic/<arm>/logs-final/`):
1. `node gen-synthetic-memory.mjs <state>/workspace 400 24`
2. `memory index --force --agent main --verbose` (creates and fills the store)
3. `memory status --json --agent main`, `memory status --deep --agent main` (read-only open, no admission)
4. `memory search "<query>" --json --agent main --max-results 25` for five queries, each a new process (receipt path)
5. the same search on a copy with `openclaw-agent.sqlite.seal` removed (first-admission path)
6. 5 timed processes per arm for each path, observer off, interleaved
7. `memory search "synthetic" ...` and `memory search "marker phrase" ...` (1-hit queries, `logs-final/g1-*`, `g2-*`)
8. divergence control (`synthetic/divergence/`): on a stopped, seal-removed copy, `inject.mjs` deletes 10 rows from `memory_index_chunks_fts` with `node:sqlite` (test-only fault injection), then two `memory search` processes; counts read from a copy afterwards

Gateway, per arm (`gateway/<arm>/logs-gw*/`):
1. `gateway run --port <port> --bind loopback --auth token --token <test-token> --allow-unconfigured` (detached; stopped with SIGTERM)
2. `gateway call memory.status --params '{"agentId":"main"}'`, `gateway call memory.search --params '{"query":"<q>","agentId":"main","maxResults":25}'` for five queries
3. `memory search "saffron glacier orchard" --json --agent main --max-results 25` with and without `OPENCLAW_GATEWAY_TOKEN` (routed to the gateway as `memory.search.owner`)
4. run 1 on a copied store, run 2 on the same store after run 1's clean shutdown

Real store copies (private; only counts, timings, hashes and observer records are published, `real/`):
1. `memory search` on the unmigrated copy (refused, schema 24)
2. `doctor --fix --non-interactive`, `agents add <id> --workspace <path> --agent-dir <path> --non-interactive`, `doctor --fix --non-interactive` (v24 -> v28), each with the arm's own build
3. `memory search "<query>" --json --agent <id> --max-results 25` for three queries, config N (`provider: "none"`) and config M (the store's own provider settings, loopback endpoint with nothing listening)
4. 5 timed processes per arm per block, observer off, interleaved

## Files

- `README.md`: this file.
- `BODY-SECTION.md`: the "Real behavior proof" section for the PR body.
- `PR-BODY.next.md`: the PR body with that section inserted before Gaps and the Gaps bullets updated; `<PROOF-URL>` marks where this directory is published.
- `gen-synthetic-memory.mjs`: deterministic synthetic memory workspace generator.
- `observe-reconcile-count.mjs`: read-only `node:sqlite` observer preload for the `derived_count` statement.
- `build.out`: clone SHAs, clean status, diff stat, build exits and phase timings, versions.
- `dist-frames.out`: built source lines of the `schema.admit` branch, the receipt-path reconcile, and the changed statement in both arms.
- `redaction-check.out`: redaction greps, substitutions and final empty results.
- `synthetic/`: `parity.md`, `timings.md`, `timing-raw.txt`, `observer-summary.md`, `observer-final-summary.md`, `workspace-manifest.out`, `env.out`, `notes.md`, `scrub.md`, `tools/`; per arm `openclaw.json`, `logs/` (cmd, out, err, exit, ms per step, count checks, `openclaw.log`), `obs/`, `logs-final/`, `obs-final/` (records from the final observer version); `divergence/` (`summary.md`, helper scripts, per arm `inject.mjs`, `inject.out`, `inspect-counts.out`, `logs/`, `obs/`).
- `gateway/`: `summary.md`, `parity.md`, `scrub.md`, helper scripts; per arm `logs-gw/`, `logs-gw2/` (gateway command, stdout, `openclaw.log`, filtered lines, every RPC call, config diff, stop tail) and `obs-gw/`, `obs-gw2/`.
- `real/`: `migration.md`, `counts.md`, `parity.md`, `timings.md`, `integrity-gate.md`, `errors.md`, `observer-summary.md`, `observer-aggregate.out`, `observe-final.sha256`, `privacy-check.out`, `observer/*.jsonl`.

`work/` and `review/` are not part of the published set.
