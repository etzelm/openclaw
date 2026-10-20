# Evidence for head 57501c047f7 (tree 76779f6d8d21527ba0778b448dc7c28d546f6f12)

Two signed commits on 53ff5be1f3b:

- `9385a46b41d` fix(agents): send a compaction continuation once after it is persisted (`src/agents/embedded-agent-runner/run/session-prompt-state.ts` +4, `run.session-prompt-state.test.ts` +12). Fixes `test/gateway-openai-compaction-replay.e2e.test.ts`, which fails on main since 07b59a0976d (#177050) and failed this PR's changed-file CI shard.
- `57501c047f7` merge of origin/main 051bf6fa4d0. Same two conflicts as the merge of dca495505aa (#178173), resolved identically; config baseline unchanged by `config:docs:gen`.

Logs ran at the unsigned commits of the same trees (d20c06b61fb, af1d1ce4a2a); paths redacted.

`compaction-fix/`
- `bisect-log.txt`, `bisect-steps.txt`: the e2e test passes at 808cb5d124c and fails from 07b59a0976d (#177050), which persists internal retry prompts as hidden `internal_system` rows. #136236 retains the compaction continuation instruction across later invisible retries because that prompt used to go unsaved, so the third request carried it twice (once from history, once appended). `requests.json`: the captured model requests.
- `main-e12719836f8/`: the e2e test fails 3/3 on main e12719836f8 and passes 3/3 with the fix; on the PR head 53ff5be1f3b it fails 3/3 and passes 3/3 with the fix. `unit-red.log`: the new unit case fails without the four lines.
- `gates/`: build, tsgo x4, `src/agents/embedded-agent-runner/` lane (116 files, 1541 tests), targeted, madge, oxfmt, oxlint at d20c06b61fb.

`merge5/`
- `gates/summary.txt`: build, tsgo x4, targeted (11 files, 243 tests), lanes cli-runner, anthropic, compat, agents/sessions, embedded-agent-runner, diff check, oxfmt, madge all exit 0.
- `gates/lane-config-sessions.log`: first run, one failure (`session-history-archive-pruning.admission.test.ts`, `database is locked` in its own seeding, load 30 to 40; file identical to main); `gates/followup/`: passes alone 3/3 here and on pristine 051bf6fa4d0, full lane rerun passes (3365 passed, 13 skipped), same totals as pristine main.
- `gates/check-changed.log`: 42 ok, 2 failed (max-lines ratchet on three `ui/` files; core test shard root budget 721/724/723/727 vs 720), both identical on pristine 051bf6fa4d0 (`gates/pristine/`).
- `gates/ci-*.log`: the three tests that failed CI at 53ff5be1f3b, 3 runs each here: compaction replay e2e 3/3 pass (fails 3/3 on pristine 051bf6fa4d0, `gates/pristine/`), `server.chat-cli-auth` 3/3, `worker-turn-launcher` 3/3.
- `gates/redgreen.log`: RED1 to RED14 red when mutated, green restored (RED13: warm-reuse field; RED14: the four fix lines).
- `harness/`: 36 scenarios plus both upgrade arms; identical to `head-53ff5be1/` after the exit-race mask, except every tree-under-test context is 323 bytes shorter, from main's 23c99ef8740 (#178108, shorter routeless reply guidance), not this PR.
