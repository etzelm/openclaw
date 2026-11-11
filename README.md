# Evidence for openclaw/openclaw#196236 (opt-in PostgreSQL server recovery captures)

- `r1-2026-11-10/`: PR body section 1. Real failed `openclaw update` with server captures and the portable control
  (`rollback-server/`, `rollback-portable/`), a successful server-capture update (`update-success-server/`), package
  provenance, the one proof-only candidate change (`candidate-doctor-fault.patch`), gates (`checks-at-head.txt`), scripts.
- `r2-2026-11-11/upgrade-2026.11.3/`: PR body section 2. Upgrade from `openclaw@2026.11.3` (npm latest) to the head and to
  base main, eight runs; `README.md` has the result table.
- `r2-2026-11-11/ci/`: the `checks-ui-e2e (1/2)` failure at 9edd6cbabc1 and the same failure on main (fixed by #197058).
- `r2-2026-11-11/merge-68441c1/`: the merge of main c324818cbf8 and the checks at that head.
- `*/scripts/`: the scripts that produced the outputs. Machine paths are replaced by placeholders described at the top
  of each script; outputs use `<e2e>`, `<w>`, `<dsn>` and `<home>` for the scratch root, work dir, connection string and home.
