# Upgrade from the latest stable release, openclaw@2026.11.3 (npm registry, 847611d)

Packages (2026-11-11, same host as the rest of the evidence):
- pr:   head 9edd6cbabc1 packed as 2026.11.8, sha256 8ea61d10618b6705ccc5734177048141e384b1266212e75d6fece51792346c74
- pr9:  head 9edd6cbabc1 packed again as 2026.11.9 (unmodified), sha256 7d75f7d0c877a1ef59f96666b8eaa1461cb25326fb8898ad7fe3eb281a85ab86
- base: main 577da8a944e (the head's main parent) packed as 2026.11.8, sha256 cfce72c73fba34b885a014ee64d63d2794fa69702df1f93f8d2565014429723d
Scripts: ../scripts/r2-upgrade-pg.sh, r2-npm.sh, r2-upgrade.sh, r2-upgrade-sqlite.sh (plus r2-setup.sh, r2-pack9.sh, env.sh, pg-up.sh). Each run: fresh isolated HOME, npm prefix,
TMPDIR and PostgreSQL database; stable gets agents.defaults.timeoutSeconds=321, Workboard enabled, a second agent `helper`,
three Workboard cards (one moved to ready), a verified portable backup (`backup create --verify`), and a standalone
`doctor --fix` original state capture. Row digests use the stable column lists, so later schema additions cannot hide a change.

| Run | Stable Workboard | Upgrade | Result |
| --- | --- | --- | --- |
| npm-pr | PostgreSQL (`database.engine: postgres` before data) | `npm install -g` head + `doctor --fix`, then `openclaw update` head 11.8 -> 11.9 with `recoveryCaptures: "server"` | pass: doctor 0, settings/agents kept, 18 tables identical, write ok, stable captures unchanged; server update rc 0, capture = anchor+manifest, CREATE/18 INSERT/COMMENT/DROP restore_ schema, rows identical |
| npm-base | same | `npm install -g` base + `doctor --fix` | same results as npm-pr (no server step: base rejects the key) |
| pg-pr / pg-base | same | `openclaw update` 11.3 -> 11.8 | both fail at candidate-state-snapshot: "Existing SQLite state data cannot switch engines"; nothing changed |
| up-pr2 / up-base | SQLite, then 11.3 `database port --to postgres` (1 store) | `openclaw update` | both fail identically at candidate-state-snapshot |
| sq-pr / sq-base | SQLite | `openclaw update` | both: second Doctor "Agent database migration did not finish: .../workboard.sqlite; expected schema 41, found 0", rollback refused (state-migrated-no-rollback); install left on 11.8, settings/agents kept, 18 tables identical, write ok, doctor 0, 8/8 stable capture files unchanged |

Notes
- 03-after.txt "restored anchor" lines (npm-*, pg-*): the 2026.11.3 archive is a legacy archive for PostgreSQL stores
  (`backup verify`: "This legacy archive has no PostgreSQL capsule ownership inventory. Unlisted exports are preserved as
  files, not imported."). Restore extracts the historical anchor, which names the live namespace, so that diff compares the
  live store (now with Card D), not a restore. Same on base. Main documents this (docs/cli/backup.md).
- 04-server-update.txt "(end)" under DDL: the log filter expected the database name in the log prefix; server-ddl.txt has
  the statements from the raw server log (only this run used server captures on that server).
- pg-pr/03-after.txt: the update failed before the package swap, so these checks ran on 2026.11.3; they show the failed
  update left settings, rows and captures unchanged. `recoveryCaptures` is rejected there because 11.3 does not know it.
- An earlier run (not kept) had HOME behind a symlink; OpenClaw refuses capture roots reached through an alias and the 11.3
  port then saw 0 stores. All kept runs use the physical path.
- Capture file counts ("stable files: 4, unchanged: 4" and "8, unchanged: 8" in 03-after.txt): the harness hashes every file
  under `<home>/.openclaw.update-captures` before and after (`caps_files` in the scripts) and prints the comparison. 01-stable.txt
  shows only the manifest lines of that list (grep filter); the full before/after lists were not kept, so the counts are the
  harness's own comparison output.
- server-ddl.txt: statement lines are cut at 170 characters, so the INSERT line ends before its SELECT. The count line (18) and
  section 1's statement log (r1-2026-11-10/rollback-server) show the full INSERT ... SELECT form.
