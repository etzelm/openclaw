Scratch driver for the real-Gateway runs (not part of the PR).

runarms.sh   runs proof.mjs once per checkout (BEFORE = 2e448432e10, AFTER = 553da8c9c96), see out-heads.txt.
proof.mjs    starts `node openclaw.mjs --profile pr179996-<arm> gateway run ...` with an isolated HOME, drives the
             Control UI in headless Chromium, and cancels each admitted sign-in with a second client
             (`gateway call wizard.cancel`).
extract.mjs  builds the redacted per-run files (rpc.jsonl, gateway-log.txt, alert.txt, wizard-cancel.txt, summary.json).
mask.mjs     paints over the one-time device code in the *-pending.png screenshots.

Post-processing done by hand after extract.mjs:
- The first line of each *-wizard-cancel.txt was rewritten from the shorthand `$ openclaw --profile <p> gateway call ...`
  that proof.mjs writes to the argv that its cli() helper actually executes:
  `$ node openclaw.mjs --profile <p> --no-color gateway call wizard.cancel --params '...' --json`.
- <arm>-version.txt is the "gateway up" line of that run's transcript (`node openclaw.mjs --version` output; pid removed).
