# Migration with each arm's own build (openclaw doctor --fix --non-interactive)

Agent database before: PRAGMA user_version 24 (copy-check). Harness note: the copied agent database was placed in a fresh state dir with no shared state catalog, so the first doctor run reconstructs the (missing) agent deletion journal and HOLDS the agent store, as documented in docs/cli/doctor/state-migrations.md, and exits 1 without migrating. The documented restore command printed by doctor (`openclaw agents add <id> --workspace <ws> --agent-dir <dir> --non-interactive`) was run, then `doctor --fix --non-interactive` again, which migrated the database. The same three-step sequence ran with each arm's build.

## store dev

| arm | step | exit | wall ms |
|---|---|---|---|
| base | memory search before migration | 1 | 5081.9 |
| base | doctor1 (store held) | 1 | 19448.7 |
| base | agents add (restore) | 0 | 2115.0 |
| base | doctor2 (migrates) | 0 | 27878.3 |
| patched | memory search before migration | 1 | 4424.7 |
| patched | doctor1 (store held) | 1 | 19944.1 |
| patched | agents add (restore) | 0 | 2258.4 |
| patched | doctor2 (migrates) | 0 | 27231.0 |

### dev base: doctor2 lines mentioning schema/migration/backup/receipt (paths replaced)

- Saved pre-migration SQLite backup: <path>
- Saved pre-migration SQLite backup: <path>
- [state<path>] agent database schema migration pending; verifying integrity first
- [state-migrations] Auto-migrated legacy state:
- - Upgraded agent database schema in <path> v24 -> v28.
- - Upgraded agent database schema in
- - Reused pre-migration SQLite backup:
- [state<path>] agent database clean-close receipt: checkpoint-incomplete

Counts on a cp -c copy after doctor2 (node:sqlite readOnly): `{"chunks":6012,"chunks_fts":6012,"chunks_fts_docsize":6012,"sources":642,"user_version":28}`. Agent seal file present after doctor: false. Pre-migration .bak present: true.

### dev patched: doctor2 lines mentioning schema/migration/backup/receipt (paths replaced)

- Saved pre-migration SQLite backup: <path>
- Saved pre-migration SQLite backup: <path>
- [state<path>] agent database schema migration pending; verifying integrity first
- [state-migrations] Auto-migrated legacy state:
- - Upgraded agent database schema in <path> v24 -> v28.
- - Upgraded agent database schema in
- - Reused pre-migration SQLite backup:
- [state<path>] agent database clean-close receipt: checkpoint-incomplete

Counts on a cp -c copy after doctor2 (node:sqlite readOnly): `{"chunks":6012,"chunks_fts":6012,"chunks_fts_docsize":6012,"sources":642,"user_version":28}`. Agent seal file present after doctor: false. Pre-migration .bak present: true.

## store main

| arm | step | exit | wall ms |
|---|---|---|---|
| base | memory search before migration | 1 | 4553.6 |
| base | doctor1 (store held) | 1 | 53784.5 |
| base | agents add (restore) | 0 | 2151.0 |
| base | doctor2 (migrates) | 0 | 89681.3 |
| patched | memory search before migration | 1 | 4691.5 |
| patched | doctor1 (store held) | 1 | 58392.9 |
| patched | agents add (restore) | 0 | 2454.9 |
| patched | doctor2 (migrates) | 0 | 87889.3 |

### main base: doctor2 lines mentioning schema/migration/backup/receipt (paths replaced)

- Saved pre-migration SQLite backup: <path>
- Saved pre-migration SQLite backup: <path>
- [state<path>] agent database schema migration pending; verifying integrity first
- [state<path>] agent database clean-close receipt: written
- [state-migrations] Auto-migrated legacy state:
- - Upgraded agent database schema in <path> v24 -> v28.
- - Upgraded agent database schema in
- - Reused pre-migration SQLite backup:
- [state<path>] agent database clean-close receipt: checkpoint-incomplete

Counts on a cp -c copy after doctor2 (node:sqlite readOnly): `{"chunks":43490,"chunks_fts":43490,"chunks_fts_docsize":43490,"sources":4577,"user_version":28}`. Agent seal file present after doctor: false. Pre-migration .bak present: true.

### main patched: doctor2 lines mentioning schema/migration/backup/receipt (paths replaced)

- Saved pre-migration SQLite backup: <path>
- Saved pre-migration SQLite backup: <path>
- [state<path>] agent database schema migration pending; verifying integrity first
- [state<path>] agent database clean-close receipt: written
- [state-migrations] Auto-migrated legacy state:
- - Upgraded agent database schema in <path> v24 -> v28.
- - Upgraded agent database schema in
- - Reused pre-migration SQLite backup:
- [state<path>] agent database clean-close receipt: checkpoint-incomplete

Counts on a cp -c copy after doctor2 (node:sqlite readOnly): `{"chunks":43490,"chunks_fts":43490,"chunks_fts_docsize":43490,"sources":4577,"user_version":28}`. Agent seal file present after doctor: false. Pre-migration .bak present: true.

Counts before doctor (verified copies, copy-check): dev chunks 6012, fts_docsize 6012, sources 642, user_version 24; main chunks 43490, fts_docsize 43490, sources 4577, user_version 24.
