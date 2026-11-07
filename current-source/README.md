# Current-source evidence for #190001

Base: `7c2ff8f775a` (the PR head's `main` parent). Fix: `27ab37717af` (PR head). PostgreSQL 17.11 (pgvector image),
loopback only. The Gateway was built with `pnpm build` from each tree and run as an isolated Gateway
(`gateway run --bind loopback`) with `database.engine=postgres`.

## gateway-trace/

A small synthetic store seeded through the base Gateway's own RPCs (`sessions.create`, `chat.inject`,
`sessions.catalog.import`): 8 sessions with 2 to 600 visible messages, 4 imported Claude Code threads with hidden
tool rows between turns, and one sparse session (1 visible reply, 250 silent `NO_REPLY` replies, 1 visible reply).
Shape in `seed-plan.json`. Each arm restores the same database template and home, boots, warms every session twice,
then sends sequential `chat.history` calls (3 per session) with PostgreSQL statement logging on.

`SUMMARY-snapshots.txt` (from `scripts/snap_ana.py`) splits each read-only transaction in a call window by what it
reads: `pending` (pending-input count), `page` (history page reads), `other` (background work on another backend,
for example the session roster scan). Means per call:

| shape | arm | runs (3 calls each unless noted) | page snapshots | page reads | pending snapshots |
|---|---|---|---|---|---|
| sparse session, `limit: 2` | base | sparse-base-L1, -L4, -L5, -L8, -L9, -s1, -s2 | 3.0 | 11.0 | 1.0 |
| sparse session, `limit: 2` | fix | sparse-fix-L2, -L3, -L6, -L7, -L10, -s1, -s2 | 1.0 | 11.0 | 1.0 |
| imported Claude Code threads, `limit: 2` | base and fix | same 14 runs (12 calls each) | 1.0 | 3.0 | 1.0 |
| 12 sessions, `limit: 100` | base | base-r1, -r2, -r3 (36 calls each) | 1.0 | 3.0 | 1.0 |
| 12 sessions, `limit: 100` | fix | fix-r1, -r2, -r3 (36 calls each) | 1.0 | 3.0 | 1.0 |

Run order: L1 to L10 alternate base, fix, fix, base, base, fix, fix, base, base, fix; s1/s2 ran base, fix, fix, base.
The database writes its log to the container's stderr, so a short line can land inside another backend's long
DETAIL line (once, in sparse-base-L1). The analysis splits lines at every embedded log prefix before matching.

Every call returned `ok`, and both arms returned the same message counts (`runs/*/calls.json`). Round 3 ran fix
first. `SUMMARY-backends.txt` shows statements on other backends follow run position, not the arm (r1 base 0.22, fix
0.83; r3 fix 0.31, base 1.03 per call), while statements on the history backends are equal (8.25 per call, 8.31 in
fix-r2).

Raw statement lines (durations only, no bound parameters) are in `runs/<run>/statements.log`, and per-call sequences
are in `runs/<run>/per-call.jsonl`.

`SUMMARY-latency.txt` (from `scripts/lat_ana.py`): after each L run's trace, statement logging off, a 20 s
closed-loop `chat.history` run on the sparse session at concurrency 1 (`runs/<run>/latency.json`). Median of the
per-run values (range):

| arm | runs | requests | errors | p50 ms | p95 ms | p99 ms |
|---|---|---|---|---|---|---|
| base | 5 | 2299 | 0 | 30.86 (30.73 to 68.14) | 82.77 (40.01 to 272.69) | 93.13 (78.25 to 410.36) |
| fix | 5 | 3142 | 0 | 29.29 (24.19 to 34.73) | 38.47 (32.57 to 81.08) | 82.43 (44.93 to 182.89) |

The host was shared with other work: 1-minute load average 20.5 to 64.6 (`host-load-during-latency-runs.txt`).

## tests/

- `conformance-red.log`: the new `session-history-read-snapshot.postgres.test.ts` on base. Sparse page has 3 read-only
  `BEGIN`s and the Claude CLI session after a provider switch has 7 (expected 1). The rollback test fails because the
  function does not exist on base.
- `conformance-green.log`: on the PR head, the new test plus the PostgreSQL bridge, read-facts, reuse, publication,
  hydration, agent and state database suites. 15 files, 154 tests pass.
- `unit-fix.log`: consumers of the changed modules (CLI session history, history worker, reader, tail, lookup,
  read-only scope). 16 files, 223 tests pass.

## ci-lanes/

The PR's red lanes, rerun locally:

- `test-lines-old-ci-merge.log`: the CI merge tree (PR head into `main` `8e6e2ae5`) reproduces `over by: 8; net delta:
  +146`. The PR adds 146 test lines and allocates 146, so the 8 came from that `main` base.
- `test-lines-merge-into-current-main.log`, `baseline-ratchets-merge-into-current-main.log`: on the PR head merged
  into current `main` (`638a1851e7e`), all 10 baseline ratchets pass (test lines slack 71).
- `ui-e2e-creator-review-merge-into-current-main.log`: `ui/src/pages/templates/creator-review.e2e.test.ts` passes on
  the same merge (4 passed, 1 skipped as in CI). The CI failure waited for a "Create Template" menu item. `main`
  renamed it to "Create template" in #192907 after the CI base.

- `check-changed-merge-into-current-main.log`: `pnpm check:changed --base 638a1851e7e` on the same merge. Typecheck,
  format, lint (0 errors), Knip (0 unused exports) and 35 timed guard steps pass. Only `changelog attributions` fails,
  on existing `CHANGELOG/2026.6.8.md` and `CHANGELOG/2026.7.1.md` lines this change does not touch.
- `changelog-attributions-current-main.log`: the same script on plain current `main` fails with the same 20 lines.

## scripts/

The seed, trace and analysis scripts used above.

## New head 213409bf (merge of `main` 3c130c7268e, no code change)

- `ci-lanes/baseline-ratchets-new-head.log`: `pnpm check:baseline-ratchets` against the merged `main`, 10/10 ok
  (test lines slack 96).
- `ci-lanes/ui-e2e-creator-review-new-head.log`: creator-review e2e, 4 passed, 1 skipped.

## network-hop/ (new head 213409bf vs its main parent 3c130c7268e)

The Gateway connects to PostgreSQL through toxiproxy (1 ms latency toxic on each stream). `rtt.txt` has the measured
`SELECT 1` round trip without the toxics and before and after the runs. The seed adds a Claude CLI session made by one
`chat.send` turn through the stub `claude` in `scripts/fake-claude.js` (copied from
`test/e2e/qa-lab/runtime/reply-run-plugin-reload.product-proof.e2e.test.ts`), 250 silent replies and a visible one,
then a `sessions.patch` back to the default OpenAI model. Runs N1 to N10 alternate base fix fix base base fix fix base
base fix. Each run starts only below a 1-minute load of 32 (`load-gates.txt`), traces 3 calls per session (N4 to N10;
N1 to N3 kept latency only), then runs 20 s closed-loop `chat.history` loads at concurrency 1 and 8 per shape
(`runs/<run>/load-<shape>-c<n>.json`, with `load1` at start and end). `SUMMARY-latency.txt` and
`SUMMARY-snapshots.txt` aggregate them (`scripts/lat_ana2.py`, `scripts/snap_ana.py`).
`tests/conformance-green-new-head.log`: the 15 PostgreSQL conformance files on 213409bf, 165 tests pass.
