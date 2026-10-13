# Evidence for openclaw/openclaw#165112

Source tree `b212accec2f16baecd4cbf7f9b77e94ec9cfe52c` (head `88a9690a48e9`), base `f307d64378846f0a98747eeda93d8dd46d056a4b`. The runs name the build commit `511f9a0a760`, an unsigned commit with the same tree. All runs on one machine (macOS 27, arm64, node 24), isolated profiles (fresh `HOME`, `OPENCLAW_HOME`, state directory), loopback Gateway, the repo's scripted OpenAI-compatible mock provider, a synthetic key, and for the CLI shapes a synthetic `claude` executable (`drivers/claude`).

| Path | What |
|---|---|
| `cases/<case>.out` | real `openclaw doctor` and `doctor --fix` on a source build, Gateway turns (operator `chat.send`, `agent` RPC, forced isolated cron run) before and after; cases `root`, `both`, `subdir`, `neither`, `agentsmd`, `env`, `tilde`, `include` |
| `cases/<case>-doctor-preview.log`, `-doctor-fix.log` | full Doctor output |
| `cases/<case>-config-before.json`, `-config-after.json` | config before and after Doctor |
| `cases/<case>-tree-*.txt` | sha256 prefix of every workspace file before Doctor, after Doctor, after the Gateway run |
| `updater/<shape>/updater-<shape>.out` | published `openclaw@2026.10.2` from npm runs the profile, then its own `openclaw update --tag <candidate.tgz>`; the candidate Gateway runs on the same state; shapes `root` (files only in the shared root), `subdir` (files only in `<root>/main`), `cli` (claude-cli backend with a conversation stored by 2026.10.2). The `base` label in the first line is the upstream tip fetched when the run started, not the candidate's base. |
| `updater/<shape>/update.log` | full updater output |
| `updater/<shape>/gateway-candidate.log` | candidate Gateway log |
| `updater/cli/stub.log`, `claude-projects.txt` | every spawn and turn the synthetic `claude` received; its transcript in each Claude project folder after the candidate run |
| `updater/cli/gateway-rollback.log` | published 2026.10.2 started on the state the candidate left: refused by the database schema check |
| `interactive/` | installed candidate package, `openclaw doctor` without `--fix` in a pseudo-terminal (`drivers/doctor-interactive.exp`): "Apply recommended config repairs now?" declined, then accepted; Gateway turns after |
| `lifecycle/` | source build, claude-cli conversation in the shared root; `doctor --fix` with `OPENCLAW_CONFIG_READONLY=1`; more turns in the root; `doctor --fix`; turns in `<root>/main` |
| `tests/green3.log` | the two targeted test files at the tree |
| `tests/red3-<rev>.log` | the same tests with the production files of `587b44ed771` (tree of the previous head `a3ad193228e5`) or `898f0a061f8` |
| `tests/cc9.log` | `node scripts/check-changed.mjs --base <base>`, with the `extensions/amazon-bedrock/index.test.ts` line removed from `config/max-lines-baseline.txt` in the working tree only (a stale entry on main that fails the max-lines ratchet for any change) |
| `tests/lanes3.log` | `src/commands/doctor/`, `src/commands/doctor-config-flow*`, `src/agents/cli-session.test.ts`, `test/scripts/pr-wrapper-source-closure.test.ts`, `test/scripts/eager-import-closure.test.ts` |
| `tests/build5.log`, `tests/pack2.log` | `pnpm build`, candidate package |
| `drivers/` | the scripts that produced everything above |
