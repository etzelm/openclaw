# PR 165112: real sandbox-enabled turns (Docker), final effects on a sibling agent's files

Run date: 2026-10-05, Mac Studio via the MacBook node, `ssh studio` (account `<studio-user>`).
Nothing was pushed and the PR was not edited. All `pr165112-` resources and the staging dir were removed (see Cleanup).

## What was run

- **Code under test:** PR branch `fix/converged-roster-workspace-pin` on fork `etzelm/openclaw`, head `06cd0cffa1b2ba9809f6fad70824f07d15929ed2` (`fix(doctor): warn instead of pinning the shared root for a converged system agent`). Shallow-fetched from GitHub, `pnpm install --frozen-lockfile && pnpm build`. `openclaw --version` printed `OpenClaw 2026.9.8 (06cd0cf)`. No newer head was used.
- **Real container runtime:** Docker 29.8.1 (client and server) on the Studio, `/usr/local/bin/docker`, reached as `<studio-user>`. Every case below is a real sandbox container created by the Gateway's own Docker backend (`backend: "docker"`), with the real `read`/`write`/`exec` tools going through the real fs bridge. **No host-path shim is involved anywhere.** `docker inspect` mounts are recorded per case.
- **Sandbox image:** the repo default (`openclaw-sandbox:bookworm-slim`) was not built, to avoid creating images outside the `pr165112-` namespace. I tagged the already-present local `python:3.12-alpine` as `pr165112-sandbox:py` (a tag only, no pull, no build). The fs bridge needs `sh` and `python3`; this image has both (busybox + Python 3.12.15). Container user is `501:20`, `NetworkMode=none`, `WorkingDir=/workspace`, container prefix `pr165112-sbx-`.
- **Isolated profile per case** (fresh dir each time, redacted as `<profile>`): `OPENCLAW_HOME`, `OPENCLAW_STATE_DIR`, `OPENCLAW_CONFIG_PATH` all under the staging dir, loopback Gateway on port 28412 (`gateway run --bind loopback`), synthetic `OPENAI_API_KEY=sk-pr165112-synthetic`, nothing under `/Users/<studio-user>/.openclaw` (verified absent at the end).
- **Scripted provider:** the repo's `scripts/e2e/mock-openai-server.mjs` with its `MOCK_RESPONSE_CONTROL` scripted-`responses` feature (a list of Responses-API `function_call` event sequences, one per model request). Full request bodies were logged (`OPENCLAW_MOCK_OPENAI_REQUEST_LOG_BODY_MAX_BYTES` raised) so the provider-visible system prompt is captured. The model made `agent --agent main` call, in order: 23 probes via the real `read`, `write` and `exec` tools. The Gateway issues one extra "Activity recap" model request first; it consumed script entry 0, so entry 0 is a dummy `recap` text response and the 23 probes follow.
- **Roster in every profile:** `agents.ownership: "explicit"`, `agents.defaults.systemAgent: {agentId: "main"}`, `agents.defaults.workspace: <profile>/workspace` (root), `agents.entries: {main: {}, dev: {}}` (both unpinned), sibling file `<root>/dev/SOUL.md` containing `PR165112-DEV-SOUL-MARKER sibling agent persona`.
- **Sandbox config added for the turn:** `agents.defaults.sandbox = {mode: "all", backend: "docker", scope: "agent", workspaceAccess: <none|ro|rw>, docker: {image: "pr165112-sandbox:py", containerPrefix: "pr165112-sbx-", network: "none"}}`. Doctor was run on the profile before this block was added (so Doctor could not try to build sandbox images); the block was added right before the turn.
- **Layouts** (what is on disk before Doctor):
  - `subdir`: customized `<root>/main/SOUL.md` (+ `memory/`), root has no persona files.
  - `neither`: no persona files in root or `<root>/main`.
  - `rootonly`: customized `<root>/SOUL.md` (+ `memory/`), nothing under `<root>/main`.
- **Cases:** `pre` = no Doctor run; `post` = `openclaw doctor --fix --non-interactive` (patched Doctor from this head) first. 6 layouts/phases x 3 access modes = 18 real turns. Case A = `pre` (subdir and neither), case B = `post` (subdir and neither), case C = `post rootonly` (plus `pre rootonly` as a control that must match).
- **Positive controls (per case, so a broken mount cannot masquerade as a denial):** `<root>/pr165112-control.txt` = `CONTROL-ROOT` and `<root>/main/pr165112-control.txt` = `CONTROL-MAIN` are planted; in `none` mode the guest writes then reads back its own file (`own-write`). Results: the guest read `CONTROL-ROOT` (pre and root-only ro/rw), `CONTROL-MAIN` (post subdir/neither ro/rw), and its own written file in every `none`/`rw` case. See the detail section.

## Doctor outcomes (verbatim excerpts in raw logs)

| layout | Doctor result |
|---|---|
| subdir | `Set agents.entries.main.workspace to <profile>/workspace/main so its working directory, persona, and memory use one workspace.` Config diff: `"main": {"workspace": "<profile>/workspace/main"}` |
| neither | same pin to `<profile>/workspace/main` |
| rootonly | warning only, no config change: `Agent "main" has workspace files in <profile>/workspace (its working directory) but resolves its persona and memory to <profile>/workspace/main. Doctor did not pick a workspace for it; set agents.entries.main.workspace to <profile>/workspace to keep the files in place, or to <profile>/workspace/main after moving them there.` |

## Result table (config x access mode -> effect on the sibling `<root>/dev/` files)

"Sibling" means `<profile>/workspace/dev/SOUL.md`. Truth for writes is the host check after the turn (sha256 of `dev/SOUL.md`, probe files listed by `find`). `dev/SOUL.md` sha256 before = `f643f5613ad08731f4f60a475ff95a2cd1c61a0e497837d755f1d4c71b288bd6`.

| config | access | container mounts (`docker inspect`, host -> guest) | Working directory seen by provider | reads of sibling | writes / exec effect on sibling (host verified) |
|---|---|---|---|---|---|
| **A: before Doctor** (subdir, neither and root-only all identical) | none | private copy `<profile>/state/sandboxes/workspace-*` -> `/workspace` rw, its `skills` -> `/workspace/skills` ro | `/workspace` | none (`/workspace/dev/SOUL.md` not found) | writes and `touch`/`echo >>` succeed only inside the private copy (`<sandbox-copy>/dev/...`). Host sha256 unchanged, zero probe files under `<profile>/workspace`. |
| A | ro | **`<profile>/workspace` (the shared root) -> `/agent` ro**, private copy -> `/workspace` ro | `/workspace` | **YES: `read /agent/dev/SOUL.md` and `exec cat /agent/dev/SOUL.md` returned the marker** | `write` tool not offered; exec writes get `Read-only file system`. Host sha256 unchanged, no probe files. |
| A | rw | **`<profile>/workspace` (the shared root) -> `/workspace` rw** | `/workspace` | **YES: `read /workspace/dev/SOUL.md` and `exec cat /workspace/dev/SOUL.md` returned the marker** | **YES: `write /workspace/dev/pr165112-write-probe-ws.txt` and `exec touch /workspace/dev/pr165112-exec-touch-ws.txt` created files in the sibling dir on the host; `exec echo EXEC-TAMPER >> /workspace/dev/SOUL.md` changed the sibling file (sha256 changed).** |
| **B: after patched Doctor** (subdir and neither, pinned `<root>/main`) | none | private copy -> `/workspace` rw (+ skills ro) | `/workspace` | none | same as A none: private copy only, host sha unchanged, no probe files on host |
| B | ro | **`<profile>/workspace/main` -> `/agent` ro**, private copy -> `/workspace` ro | `/workspace` | **none** (`/agent/dev/SOUL.md` and `/workspace/dev/SOUL.md` not found; `CONTROL-MAIN` read OK at `/agent`) | `write` tool not offered; exec writes: no such directory / `Read-only file system`. Host sha unchanged, no probe files. |
| B | rw | **`<profile>/workspace/main` -> `/workspace` rw** | `/workspace` | **none** (`/workspace/dev/SOUL.md` not found; `CONTROL-MAIN` read OK) | write tool and exec succeeded only inside the agent's own tree: files appeared at `<profile>/workspace/main/dev/pr165112-*` and `main/pr165112-own-write.txt`. Sibling `<profile>/workspace/dev/` untouched: sha256 unchanged, no probe files there. |
| **C: root-only after patched Doctor** (warn, no pin) | none | same as A none | `/workspace` | none | same as A none |
| C | ro | `<profile>/workspace` (shared root) -> `/agent` ro | `/workspace` | **YES** (same as A ro) | same as A ro: no writes, sha unchanged |
| C | rw | `<profile>/workspace` (shared root) -> `/workspace` rw | `/workspace` | **YES** (same as A rw) | **YES**, same as A rw: sibling files created, `SOUL.md` sha256 changed |

Reading of the table:

- With the pin (B), `ro` and `rw` mount only `<root>/main`, so the sibling is unreachable by the file tools and by in-container `cat`/`touch`/`echo`. Writes land under `<root>/main/dev/`, never the real `<root>/dev/`.
- Without the pin (A) and in the root-only layout (C), where Doctor warns and deliberately does not pin, `ro` exposes the sibling for reading (at `/agent`) and `rw` exposes it for reading and writing (at `/workspace`). C is byte-for-byte the same effect as A, as the task expected.
- `workspaceAccess: none` never touches the sibling in any config.
- Path traversal does not escape: `../dev/...` resolves in the guest to `/dev/...` (container `/dev`), which the bridge reports as `container-only` and exec reports `Permission denied`. The exposure is entirely through which host directory is bind mounted, which is exactly what the pin changes.
- Under `ro` the `write` tool is not offered to the model at all (`Tool write not found`), matching the docs.
- In `rw` the `/agent/...` probes are denied/not found because `/agent` only exists in `ro` mode; `/workspace/...` probes do the work there.

Also visible in the provider-visible system prompt (captured in the logs): pre-Doctor `rw` shows `File tools use host workspace <profile>/workspace` and project context from `<profile>/workspace/main/AGENTS.md`, i.e. the file tools and sandbox mount the shared root while the persona/context files come from `<root>/main` (the divergence the Doctor pin removes). Post-Doctor `rw` shows host workspace `<profile>/workspace/main` and context from `<profile>/workspace/main/AGENTS.md`.

## Caveats, stated plainly

- The scripted provider replays fixed tool calls; it does not test model behavior, only what the tools can reach. The repo's mock had to be driven with a custom script file (`h/harness.mjs script`); the mock itself is unmodified.
- The image is a tagged alias of `python:3.12-alpine`, not the repo's `bookworm-slim` sandbox image. Mount behavior, the fs bridge and the exec tool are the real code; only the guest userland differs.
- Doctor ran without the sandbox block in config (added afterward) to avoid Doctor image/sandbox repair paths. The roster and layouts were identical.
- Each case used a freshly initialised profile (an earlier attempt to reuse state tripped the Gateway's `WORKSPACE_VANISHED` attestation after I deleted `state/sandboxes`; that run was discarded).
- Docker Desktop on macOS shares bind mounts through virtiofs; the `ro` mounts are enforced by the kernel inside the guest (`virtiofs ... ro` in `/proc/mounts`, `Read-only file system` on write).

## Cleanup (confirmed)

Containers, the `pr165112-sandbox:py` image tag, the staging dir `~/Library/Caches/pr165112-sandbox` (repo, pnpm store, profiles), the `~/Library/Logs/pr165112-*` logs, and the temporary artifact HTTP server were removed. The original `python:3.12-alpine` image was left in place. Command output is in the final section of this file.

## Files

- `report-summary.md`: generated per-case table (mounts, reads, writes, host checks).
- `report-detail.md`: per-case, per-probe table (all 23 probes x 18 cases, with raw tool output).
- `raw/<case>/`: for each case `mock-requests.jsonl` (full provider requests incl. system prompt), `agent-turn.json`, `gateway.log`, `mock.log`, `config.redacted.json`, `docker-mounts.*.json`, `docker-config.*.txt`, `docker-ps.txt`, `host-verify.txt`, `mock-control.json.probes.json`; `raw/doctor-<case>/` has `doctor.out`, `config.before/after.json`, `config.diff.txt`, `tree.before/after.txt`.
- `scripts/`: `harness.mjs` (profile init, sandbox config, controls, probe script), `run-case.sh`, `run-doctor.sh`, `run-all.sh`, `summarize.mjs`, `report.mjs` and the small one-off patch scripts used to edit them during the run.
- `logs/`: clone, build, doctor and run-all driver logs.

## Cleanup confirmation (command output, Studio, after removal)

```
== staging dir:
ls: /Users/<studio-user>/Library/Caches/pr165112-sandbox: No such file or directory
== pr165112 logs in ~/Library/Logs:
0
== rm still running:
0
== ~/.openclaw:
ls: /Users/<studio-user>/.openclaw: No such file or directory
== containers named pr165112-:
0
== images matching pr165112:
0
== python:3.12-alpine (original, untouched):
python:3.12-alpine 1b668429b351
== volumes:
0
== networks:
0
== listeners 28411/28412/28499:
0
== stray processes:
0
```

Earlier `docker rmi pr165112-sandbox:py` removed only the tag; the HTTP artifact server on port 28499 was stopped before the staging dir was deleted.
