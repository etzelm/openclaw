# Evidence for openclaw/openclaw#165112

Source tree `a28e59b1ec0d38fe9237548b88c30acbf495e627` (head `a3ad193228e5`), base `f307d64378846f0a98747eeda93d8dd46d056a4b`. All runs on one machine (macOS 27, arm64, node 24), isolated profiles (fresh `HOME`, `OPENCLAW_HOME`, state directory), loopback Gateway, the repo's scripted OpenAI-compatible mock provider, a synthetic key, and for the CLI shape a synthetic `claude` executable (`drivers/claude`).

| Path | What |
|---|---|
| `cases/<case>.out` | real `openclaw doctor` and `doctor --fix` on a source build, Gateway turns (operator `chat.send`, `agent` RPC, forced isolated cron run) before and after; cases `root`, `both`, `subdir`, `neither`, `agentsmd`, `env`, `tilde`, `include` |
| `cases/<case>-doctor-preview.log`, `-doctor-fix.log` | full Doctor output |
| `cases/<case>-config-before.json`, `-config-after.json` | config before and after Doctor |
| `cases/<case>-tree-*.txt` | sha256 prefix of every workspace file before Doctor, after Doctor, after the Gateway run |
| `updater/<shape>/updater-<shape>.out` | published `openclaw@2026.10.1` from npm runs the profile, then its own `openclaw update --tag <candidate.tgz>`; the candidate Gateway runs on the same state; shapes `root` (files only in the shared root), `subdir` (files only in `<root>/main`), `cli` (claude-cli backend with a conversation stored by 2026.10.1) |
| `updater/<shape>/update.log` | full updater output |
| `updater/cli/stub.log` | every spawn and turn the synthetic `claude` received, with cwd, session id and resume mode |
| `updater/cli/claude-projects.txt` | the synthetic `claude` transcript in each Claude project folder after the candidate run |
| `updater/<shape>/gateway-candidate.log` | candidate Gateway log |
| `tests/green.log`, `tests/red.log` | targeted tests at the tree; the repair test file against the repair module of the previous head `0b5464403a02` |
| `tests/check-changed.log` | `node scripts/check-changed.mjs --base <base>` |
| `tests/lanes.log`, `tests/lanes-failures-*.log` | owning-directory lanes; the failing files re-run at the tree and at the base |
| `tests/build.log`, `tests/pack.log` | `pnpm build`, candidate package |
| `drivers/` | the scripts that produced everything above |
