# Evidence for head 12b692d36b0 (merge of main cab0df90f87 into 57501c047f7, tree 794b4d3ec1f)

Logs ran at 5e350e8aeb0, the unsigned commit of the same tree. Conflict: the generated config baseline hash, regenerated (`config:docs:check` ok). Main's #178572 rewrote `history-boundary.incognito.test.ts` and dropped the `PreparedCliRunContext` import this PR's incognito case uses; the merge restores it (`diff-merge-resolution.patch`). That case passes, and fails when the host actor owner check is replaced by `true`.

`gates/summary.txt`: tsgo x4, madge, build, ai build, targeted (11 files), lanes cli-runner, anthropic, agents/sessions, embedded-agent-runner, config/sessions, diff check all exit 0 at the final tree (`tsgo-core-test` exit 2 is the run before the import was restored; `tsgo-core-test-2` is after). `gateway-openai-compaction-replay.e2e.test.ts` passes 3/3 (`e2e-compaction-*.log`).
