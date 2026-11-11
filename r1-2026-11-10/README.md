# Evidence for PR 196236 at b7842b029bc

- `pack-provenance.txt`, `candidate-doctor-fault.patch`: what the two packages are and the one synthetic step.
- `rollback-server/`: real failed `openclaw update` with `recoveryCaptures: "server"`, rolled back by the installed
  updater. 01 setup, 02 update exit, 03 after (steps, capture files, statement log, anchor, schemas, row digests,
  manifest, local exports), 04 standalone Doctor and allocation checks, 05 the copy statements in and out of the
  capture schema. Note: 03 contains one failed query (`sequences in Workboard namespaces`, a quoting bug in the test
  script); 04 re-runs it correctly on the same database.
- `rollback-portable/`: the same failed update with the setting unset, for comparison.
- `update-success-server/`: an earlier run at 680518deb7d whose candidate fault sat in `update migrate`, which the
  package update does not run, so the update completed. It shows the server capture created and dropped on verified
  retirement at this head; its row-digest format is the older one. Not quoted in the PR body.
- `checks-at-head.txt`: conformance, unit, config, ratchet, docs and check:changed results.

Scripts that produced them: `scripts/` (env.sh, pg-up.sh, pack2.sh, rollback-e2e.sh, after-checks.sh, gates.sh,
gates2.sh, gates3.sh).
