# RFC 0039 foreground proof

Live proof for RFC 0039 (guest foreground work and visible restart stops). It
runs the built Gateway, not mocks, and checks each behavior from Gateway
state, transcripts, the Gateway log, and the model stub's request log.

This is a draft implementation of RFC 0039, pending RFC acceptance.

## What runs

- A scratch Gateway in trusted-proxy mode on loopback. Two users sign in
  through the proxy headers: `staff@example.test` (default role) and
  `guest@example.test`. Staff assigns the guest role with `users.setRole`.
  The guest role has `execution: "foreground-only"`.
- A loopback OpenAI-compatible model stub. `SLOW:` and `DELAY:` markers hold a
  turn open, and the stub logs every request it receives.
- The local Docker or Podman sandbox image.
- `ws-client.mts` drives the real Gateway WebSocket protocol as each user,
  with no device token. It can close the tab while a turn runs.
- Restart uses `SIGUSR2` with the script as the supervisor. The crash case
  uses `SIGKILL`.

## Run it

```bash
pnpm install --frozen-lockfile
pnpm build
bash qa/rfc0039-foreground/run-proof.sh main
```

Upgrade from an earlier build on the same state:

```bash
# at the earlier commit, built
PROOF_ROOT=/tmp/rfc0039-upgrade bash qa/rfc0039-foreground/run-proof.sh upgrade-base
# at this commit, built
PROOF_ROOT=/tmp/rfc0039-upgrade bash qa/rfc0039-foreground/run-proof.sh upgrade-head
```

Each check prints `PASS` or `FAIL`. The script exits non-zero on any `FAIL`.
Set `PROOF_SANDBOX_IMAGE` and `DOCKER_HOST` when the defaults do not match the
host.

## RFC section 6 coverage

| RFC row                                   | Check                                                                                                                                                        | Result |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ |
| Restart during guest generation           | B: guest turn not replayed (model requests stay at 1); one "Stopped after restart." notice                                                                   | PASS   |
| Hard crash                                | E: not replayed after `SIGKILL`; the notice says "Interrupted, not resumed." and claims no cause                                                             | PASS   |
| Repeated startup                          | F: a second restart adds no duplicate restart or crash notice                                                                                                | PASS   |
| Promotion or revocation                   | R: the role changes during a sealed turn whose tab closed; the Gateway aborts the run and no reply is recorded                                               | PASS   |
| Shared thread with later staff work       | B: the staff turn in the same restart resumes (model requests reach 2)                                                                                       | PASS   |
| Tab disconnect without restart            | T: the tab closes after admission and the bounded turn still records its reply                                                                               | PASS   |
| Old request retry with a retained receipt | C: same-ID retry returns `status: ok` with no model request                                                                                                  | PASS   |
| New request after interruption            | D: a new ID runs in the same conversation                                                                                                                    | PASS   |
| Compatible restart, upgrade               | U: state written by the earlier build stays readable; its interrupted guest turn is not replayed; one notice; a retry is not dispatched; a fresh reply works | PASS   |
| Busy thread (RFC section 1)               | B1: a second guest message is refused with "It was not queued."; L: the refused text reaches no model request and no transcript message                      | PASS   |
| Sandbox                                   | containers on the host are unchanged after the run                                                                                                           | PASS   |

Rows covered by focused tests rather than this live run:

| RFC row                                          | Test                                                                                                                                                    |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Eviction from the 64-ID list                     | `src/agents/main-session-recovery/foreground-restart-stop-receipt.test.ts`                                                                              |
| Receipt lookup unavailable                       | same file: a lookup failure reports unavailable, not absent                                                                                             |
| Revocation while admission awaits                | `src/agents/foreground-request.test.ts`: input is checked again after each admission await                                                              |
| Concurrent busy sends                            | `src/gateway/server-methods/chat-send-foreground-busy.test.ts`: the writer barrier refuses the second send                                              |
| Busy thread on other channels                    | `src/auto-reply/reply/get-reply-run-admission.session-file.test.ts`: the reply layer refuses without dropping queued work, and a heartbeat stays silent |
| Generic cleanup with unknown policy or ownership | `src/agents/sandbox/registry.test.ts`                                                                                                                   |
| Launch refused after custody                     | `src/agents/sandbox/container-engine.foreground.test.ts`: recorded as not dispatched                                                                    |
| Unconfirmed cleanup                              | `src/agents/agent-run-terminal-outcome.test.ts`                                                                                                         |

Not covered here: explicit deletion of all receipts, the alternate producer
row (covered by the existing stack's enforcement tests), a real downgrade,
and a focused test of the spawn broker worker's cancel-launch. The downgrade rule is documented in
`docs/gateway/operator-scopes.md`.

## Output

Raw output from `run-proof.sh main` at commit `416cca35142`. Later commits on
this branch change only focused tests, formatting, lint fixes in this harness,
and this document. Session keys and IDs are from the scratch Gateway.

```text
=== B1: a second guest message while busy
$ rpc as guest: chat.send {"sessionKey":"agent:main:dashboard:16c6ca97-...","message":"SLOW:queuedwork second","idempotencyKey":"guest-2b"}
{
  "ok": false,
  "error": {
    "code": "UNAVAILABLE",
    "message": "This thread is still working on your previous request. Wait for it to finish or stop it, then send your message again. It was not queued."
  }
}
PASS B1 busy send refused (1)
=== Gateway restart (SIGUSR2)
[main-session-restart-recovery] marked 2 interrupted main session(s) for restart recovery (gateway restart shutdown)
PASS B guest turn not replayed (model requests) (1)
PASS B staff turn resumed (model requests) (2)
PASS B one restart notice (1)
HISTORY guest-after-restart messages=6
  user:SLOW:guestwork please
  assistant:Stopped after restart. This turn stopped when the Gateway restarted and was not resumed automatically, for security reasons. ...
=== C: same-ID retry of the stopped request
{ "ok": true, "payload": { "runId": "guest-2", "status": "ok" } }
PASS C retry returns a recorded result (true)
PASS C retry not dispatched (model requests) (1)
PASS D fresh request dispatched (1)
=== crash (SIGKILL)
PASS E not replayed after crash (1)
PASS E unknown-cause notice (1)
PASS F no duplicate restart notice (1)
PASS F no duplicate crash notice (1)
=== R: reassigning the guest role during a turn whose tab closed
PASS R no reply recorded after revocation (0)
PASS R Gateway aborted the run (1)
PASS L model requests containing refused text (0)
PASS L transcript user messages with refused text (0)
PASS sandbox containers unchanged (1)
=== checks failed: 0
```

Upgrade run, from the stack top `8f379b78506` to `416cca35142` on one state
directory:

```text
PASS U previous build's guest reply still readable (1)
PASS U previous build's staff reply still readable (1)
PASS U interrupted guest turn not replayed on the new build (0)
PASS U exactly one stop notice for it (1)
PASS U retry not dispatched (0)
PASS U fresh reply recorded (1)
```

## Behaviors the RFC requires

These are RFC 0039 requirements, not new defaults. They apply only to
sessions with `execution: "foreground-only"`; staff and ordinary sessions keep
their behavior.

| Behavior                                                                 | RFC text                                                                                                    |
| ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| Refuse a second guest message while the thread is busy, without queueing | Section 1: "Reject visibly and ask the user to wait or stop the active turn. Do not queue later execution." |
| A finite deadline for every foreground turn                              | Section 1: "A foreground turn has one admitted request, a finite deadline..."                               |
| One stop notice per interrupted guest turn, with no false cause          | Section 3 and the section 6 crash row                                                                       |
| Cleanup reserved for the original foreground owner                       | Section 2: "Allocation retirement policy ... Reserve cleanup for the original foreground owner"             |

## Recommendations pending RFC acceptance

RFC 0039 leaves four questions open. This branch answers each one as a
recommendation. None of them changes a behavior the RFC requires.

| Question                      | Recommendation                                                                                                                                                                                                                                                                                    | Evidence                                                                          | How to reverse                                                              |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Qualified foreground tools    | The embedded runtime with a local Docker or Podman container per admitted request. File tools, foreground exec in that container, and stateless web fetch and search are qualified. Background exec, spawn, cron, browser, node, terminal and remote placement are refused with a visible reason. | Only the per-request container gives one owner that can stop every descendant.    | Change the qualified list in the existing enforcement and the docs section. |
| Turn limit                    | Use the agent run timeout. A disabled timeout falls back to the default agent timeout, and a per-request override can only shorten it. Recommended operator value: `agents.defaults.timeoutSeconds: 600`.                                                                                         | Reuses the existing control; no new config key.                                   | Change `resolveForegroundTurnTimeoutMs`.                                    |
| Rollout and rollback builds   | Qualify the first build with this branch. Roll back only to a build that reads the foreground markers, after foreground turns settle.                                                                                                                                                             | RFC section 5: the markers are not barriers for old binaries.                     | Docs only.                                                                  |
| Channels after the Control UI | Control UI and WebChat first. Other channels later, through the final-delivery outbox.                                                                                                                                                                                                            | The notice is a transcript fact; external delivery needs its own idempotent path. | Docs only.                                                                  |
