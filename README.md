# Evidence: faster repeated memory keyword searches

BEFORE is base `a7e31844f2edcc6a0a783549f1f5c1394ec83fb8`. AFTER is this branch. Both were built with `pnpm build` on one machine: Mac Studio Mac15,14, macOS 27.0.1 arm64, Node v24.21.0, SQLite 3.53.4 from `node:sqlite`.

The AFTER measurements ran on a build of an earlier commit of the branch. That commit's production code differs from the final commit only in comments. Rebuilt, the final commit is byte-identical to it in every built JavaScript chunk (`gates-final/tree-identity.out`, `gates-final/dist-rebuild-diff.out`).

Paths are replaced by substitution: the scratch root becomes `<scratch>`, the home directory `<home>`, the machine name `<host>` and the Gateway token `<test-token>`. The real agent databases are private. Only counts, hashes, timings and plans come from them. Inputs drawn from them appear as `q09` to `q20`.

| Directory | What it holds |
|---|---|
| `build/` | `pnpm build` output for both arms |
| `proof/` | Shipped entry point runs: `node openclaw.mjs` CLI `memory search` and a real `gateway run` with 30 `memory.search` calls per arm, on a synthetic store. Includes the read-only observer preload (`tools/observe-search-prepare.mjs`), per-request counts (`summary.md`), parity (`parity.md`), plans (`plans.md`) and every command, log and observer record. `notes.md` gives the attribution method. |
| `prod/` | The built production search function (`searchKeywordWithFallback`, called the way the memory search worker calls it) on two real agent database snapshots (6,012 and 43,634 chunks) and two synthetic stores (`unicode61`, `trigram`). Contains compile counts, timing, parity, plans and `params.md`, which derives the request shape. |
| `halves/` | The same compile counting and parity on two builds that each carry only one half of the change |
| `gates-final/` | Tests, owning directory, consumers, `changed:lanes`, `check:changed`, `git diff --check`, format, red/green, cost, base checks for the two pre-existing failures, pinned-hash recomputation (`baseline-hashes.*`), tree identity |
| `mutants/` | The new test run against each single-half build |
| `fts5/` | Control for the 5 authorizer callbacks left per search: FTS5's own per-query sorter statement |
