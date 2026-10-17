# Shipped Gateway inbound reply trace: index

Machine: Mac Studio, macOS, Node v24.21.0, node:sqlite SQLite 3.53.4 (the Gateway prints both in its `native runtime` line, `runs/*/gateway-output.log`).
Arms: BEFORE = base `d4d2c3dd1e3e29b7bd19914e3c9c47d40c5dde77`, AFTER = PR head `a67486386538164828592481aca7ad2b8e925ed4`. Each arm has the same proof patch applied and is built with `OPENCLAW_BUILD_PRIVATE_QA=1 pnpm build`.
Runs, each from a fresh temporary state directory, in this order:
- small ledger (only the Gateway's own rows): `after-r1`, `before-r1`, `before-r2`, `after-r2`;
- seeded ledger (`PROOF_SEED_ROWS=200000`, see step 3): `before-large-r1`, `after-large-r1`, `after-large-r2`, `before-large-r2`.

## What runs

`scripts/run-arm.sh` records the arm's identity, then runs `scripts/gateway-reply-proof.mts` from the arm's repo root with `node --import ./scripts/tsx.mjs`. The driver uses the repo's own qa-lab harness (`extensions/qa-lab/src`):

- `startQaLabServer`: the qa-lab message bus that plays the chat platform;
- `startQaProviderServer("mock-openai")`: the qa-lab mock model provider;
- `createQaGatewayChild().start(...)`: spawns `node <arm>/dist/index.js gateway run --port <port> --bind loopback --allow-unconfigured` (`extensions/qa-lab/src/gateway-child-setup.ts:183` and `:330-340`), a real Gateway process from the arm's build, with the bundled `qa-channel` plugin configured against the bus.

The child gets the harness's usual environment (`buildQaRuntimeEnv`, `extensions/qa-lab/src/gateway-child-env.ts:58-157`): an isolated HOME, state directory and config file, plus the QA runtime flags it always sets, among them `OPENCLAW_TEST_FAST=1`, `OPENCLAW_SKIP_STARTUP_MODEL_PREWARM=1` and `OPENCLAW_NO_RESPAWN=1`. The driver adds `NODE_OPTIONS` (the observer), the observer's log path and `OPENCLAW_LOG_LEVEL=debug`. Only the driver and the harness run through tsx. The Gateway and everything inside it (qa-channel, reply dispatch, the session read worker, the lookup) run from the arm's `dist/`.

Steps:
1. An ordinary inbound DM registers the conversation.
2. The RPC `conversations.turn` (timeout 2 s) records a `turn` delivery and sends a question through qa-channel. The QA bus assigns its own message id, which differs from the prepared id, so the Gateway cancels the in-process reply waiter at once and returns `"status":"sent"`, `"correlationPersisted":true` and the error `Channel delivery did not preserve its prepared message id; reply correlation was disabled.` (`src/gateway/conversation-turn.ts:336-347`). The ledger row stays, with the bus id as `platform_message_id`.
3. The Gateway is stopped and started again on the same state with the harness's `restartAfterStateMutation`. In the seeded runs the mutation, while the Gateway is stopped, inserts 50 synthetic conversations and 200,000 delivery rows into the Gateway's agent database with the generator of store a in the timing measurements (`measure-reply-lookup.mts`): same status mix, 30,000 `turn` rows, `updated_at` 0 to 199,999, so every seeded row is older than the Gateway's turn row. No `sqlite_stat1` table exists after seeding (`"plannerStatisticsRows":0` in `driver.log`). In the small runs the mutation does nothing.
4. An inbound reply whose reply-to id `qa-reply-target-never-delivered` was never delivered (ledger miss).
5. An inbound reply to the question from step 2 (matching delivery).

Then the ledger is read read-only (the Gateway's own rows plus totals per kind and status) and the logs are saved.

## Not part of the PR, applied to both arms

- `scripts/qa-channel-turn-correlation.proof.patch`: adds `prepareConversationTurnMessageId` (the optional outbound hook in `src/channels/plugins/outbound.types.ts:142` that opts a channel into `conversations.turn`) to the private QA test channel. Without it the Gateway rejects step 2 with `Channel qa-channel does not support correlated conversation turns; use conversations_send` (`src/gateway/conversation-turn.ts:169`); only the `reef` channel implements the hook. No core file and nothing on the lookup path changes. `scripts/proof-patch-applied-after.diff` and `scripts/proof-patch-applied-before.diff` are `git diff` of each tree after patching; the two files are byte-identical.
- `scripts/reply-lookup-observer.mjs`: loaded into the Gateway with `NODE_OPTIONS=--import <file>` (passed through the harness's `runtimeEnvPatch`). Node applies `NODE_OPTIONS` preloads to worker threads too; each thread writes an `observer-loaded` record. It wraps `node:sqlite` `prepare` and `StatementSync` `all`/`get`/`run`. For the reply lookup statement it appends one record with the thread, the statement text, the bound parameters, the returned rows (selected columns), `statementMicros` (wall time of that one statement call), `EXPLAIN QUERY PLAN` of that statement with those parameters on the same connection, and the built module names on the stack. For inserts and updates on `conversation_deliveries` it records the statement and parameters. It never changes a statement, a parameter or a result.

## Files to publish

| File | What it is |
|---|---|
| `INDEX.md` | This file |
| `build-summary.txt` | Build commands, exit codes and the failing check for the four builds (unpatched and patched, both arms) |
| `scripts/run-arm.sh` | Per-arm wrapper (identity record, then the driver) |
| `scripts/gateway-reply-proof.mts` | Driver (steps above) |
| `scripts/reply-lookup-observer.mjs` | Read-only node:sqlite observer |
| `scripts/qa-channel-turn-correlation.proof.patch` | Proof-build patch to `extensions/qa-channel/src/channel.ts` (2 added lines) |
| `scripts/proof-patch-applied-after.diff`, `scripts/proof-patch-applied-before.diff` | The patch as applied to each tree |
| `scripts/redact.py` | Redaction applied to every published run file |
| `runs/<run>/arm.txt` | HEAD, uncommitted changes (the proof patch only), the reply lookup's status clause as built in `dist/`, driver exit code |
| `runs/<run>/driver.log` | Driver timeline: message ids, `conversations.turn` result, seeding counts, restart, the observer result per reply, ordinary-dispatch answers, ledger at the end |
| `runs/<run>/observer.jsonl` | Observer records (thread loads, the turn row's three writes, one lookup record per reply) |
| `runs/<run>/gateway-output.log` | Gateway stdout and stderr for both Gateway processes of the run, at `OPENCLAW_LOG_LEVEL=debug` (redacted for secrets by the harness, then by `redact.py`) |
| `runs/<run>/bus-messages.json` | Every message on the QA bus (the platform-side view): ids, direction, text, reply-to id |

Redaction (`scripts/redact.py`): the checkout, run and harness paths, the host name and the account name are passed in through environment variables (none of them appear in the script) and become `<after-tree>`, `<before-tree>`, `<run-root>`, `<harness>`, `<host>` and `<user>`; any other home directory becomes `<home>` and temp directories `<tmp>`; the per-run qa-lab temp directory becomes `<qa-temp-root>`; loopback addresses and ports become `<loopback>:<port>`; any other dotted quad would become `<ip>` (none occur); ANSI colour codes are removed; the NUL byte the Gateway prints inside one scheduler task name (`github-publication:qa<NUL>agent:qa:main`) is written as `<NUL>`. Message ids, session ids, run ids and the conversation ref come from the fresh temporary state of each run and are kept. A grep of `runs/`, `scripts/`, `INDEX.md` and `build-summary.txt` for `/Users`, `/private`, `/var/folders`, the host name, the account name, private and loopback IPs and key prefixes finds only the generic patterns inside `redact.py`.

Do not publish `raw-DO-NOT-PUBLISH/` (unredacted copies of the same runs, the full build logs, and the Gateway's JSON file logs, which carry the host name and local paths).

## Results

Small ledger (1 delivery row, the Gateway's turn row):

| Runs | Reply | Thread | Rows | Plan for `delivery` |
|---|---|---|---|---|
| before-r1, before-r2 | miss | 9, not main | 0 | `SCAN delivery USING INDEX idx_agent_conversation_deliveries_updated` |
| before-r1, before-r2 | reply to the turn question | 9, not main | 1: `t3-01-proof-turn`, `turn`, `sent` | `SCAN delivery USING INDEX idx_agent_conversation_deliveries_updated` |
| after-r1, after-r2 | miss | 9, not main | 0 | `SEARCH delivery USING INDEX idx_agent_conversation_deliveries_reply (conversation_id=?)`, `USE TEMP B-TREE FOR ORDER BY` |
| after-r1, after-r2 | reply to the turn question | 9, not main | 1: `t3-01-proof-turn`, `turn`, `sent` | `SEARCH delivery USING INDEX idx_agent_conversation_deliveries_reply (conversation_id=?)`, `USE TEMP B-TREE FOR ORDER BY` |

`statementMicros` in the small runs: 69 to 98 on both arms; with one row it says nothing about speed.

Seeded ledger (200,001 delivery rows over 51 conversations):

| Runs | Reply | Thread | Rows | `statementMicros` (r1, r2) | Plan for `delivery` |
|---|---|---|---|---|---|
| before-large | miss | 10, not main | 0 | 36305, 36206 | `SCAN delivery USING INDEX idx_agent_conversation_deliveries_updated` |
| before-large | reply to the turn question | 10, not main | 1: `t3-01-proof-turn`, `turn`, `sent` | 95, 83 | `SCAN delivery USING INDEX idx_agent_conversation_deliveries_updated` |
| after-large | miss | 10, not main | 0 | 60, 69 | `SEARCH delivery USING INDEX idx_agent_conversation_deliveries_reply (conversation_id=?)`, `USE TEMP B-TREE FOR ORDER BY` |
| after-large | reply to the turn question | 10, not main | 1: `t3-01-proof-turn`, `turn`, `sent` | 156, 84 | `SEARCH delivery USING INDEX idx_agent_conversation_deliveries_reply (conversation_id=?)`, `USE TEMP B-TREE FOR ORDER BY` |

The turn row is the newest row in the seeded ledger and the only row of its conversation, so on base the `updated_at` walk meets it first; this matching case is cheap on both arms. It is not the newest-row-in-a-busy-conversation case that the timing measurements report as slower after the change.

Every lookup record's stack names `conversation-delivery-store.kernel-<hash>.mjs` called from `session-transcript.worker.js` through `worker-task-server-<hash>.mjs`. The kernel chunk name differs between arms (`BJzQPjQ-` before, `Cnv1yVaY` after) and matches the chunk that `arm.txt` shows holding the bound list (before) or `.map((status) => sql.lit(status))` (after). Each run has exactly two lookup records, one per reply.

After each restart the Gateway log shows one `[agent/embedded] [context-diag] pre-prompt` agent run for each of the two replies (three per run, counting the first DM), and the bus shows the Gateway's answer to each reply (`replyToId` equal to the reply's id). A reply that the capture path consumes ends instead at `dispatch-from-config.prepare-context.ts:468-479` with reason `conversation-turn-reply` and no agent run, so both replies went to ordinary dispatch.

Driver versions: the four small-ledger runs ran `gateway-reply-proof.mts` before two additions, the `PROOF_SEED_ROWS` option (unset in those runs, so the restart mutation did nothing) and the final ledger read's totals per kind and status (those runs print the ledger rows as a plain array). The published script is the later version, which the four seeded runs used; with `PROOF_SEED_ROWS` unset it performs the same steps as the earlier one.
