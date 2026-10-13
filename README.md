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

## Added at tree `6a18daf4003809c816d0921b4f2f340daa96959b` (head `616f6a64ed66`; the runs name the build commit `c1f4957778f`, an unsigned commit with the same tree)

The runs above are at tree `b212acce`. Tree `6a18daf4` adds one early return in `planTree` (`src/commands/doctor/shared/system-agent-workspace-restore.ts`): a destination directory under `memory/` or `skills/` that is a link or not a directory is kept whole. None of the profiles above has such a destination (their `-tree-*.txt` listings and workspace setup), so that return is not taken in any of them.

| Path | What |
|---|---|
| `lifecycle-real/cli-real.out` | source build, the real Claude Code executable (2.1.296, a setup-token credential copied into the isolated profile and deleted after the run): a conversation in the shared root plants a codeword and a color; `doctor --fix` with `OPENCLAW_CONFIG_READONLY=1`; turns in the root ask for them and plant a number; `doctor --fix`; a pinned turn asks for all three. Replies are read back with `chat.history`. |
| `lifecycle-real/doctor-*.log`, `gateway-*.log` | full Doctor output and Gateway logs (`cli exec` lines show `useResume`, `reuse`, `historyPrompt`) |
| `compat/compat.out` | data written by published `openclaw@2026.10.2` (claude-cli conversation in the shared root), copied byte for byte to the same path for two arms: `base` (`f307d643788`) and `head` (`c1f4957778f`); each arm runs its own build's `doctor --fix --non-interactive`, then its own Gateway with two turns. Digests read every table of every database under the state directory, config leaves, workspace and Claude project files; `# differences` lists every changed row and field. |
| `compat/digest-*.json.gz` | the digests (`drivers/digest.js`), comparable with `drivers/compare.js` |
| `compat/doctor-*.log`, `gateway-*.log` | full Doctor output and Gateway logs per arm |
| `tests/green4.log`, `tests/red4-511f9a0a760.log` | the two targeted files at this tree; the same with the production files of `511f9a0a760` (tree `b212acce`) |
| `tests/cc10.log`, `tests/lanes4.log`, `tests/build6.log`, `tests/pack3.log` | check-changed (same working-tree-only baseline line removal as `cc9`), owning lanes, build, package at this tree |
| `drivers/cli-real.sh`, `gw-real.mjs`, `projects-real.sh`, `compat.sh`, `digest.js`, `compare.js` | the scripts for the runs in this section |
