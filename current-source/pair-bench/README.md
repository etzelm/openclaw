Pair bench, one main 82210a2bbdb0, PostgreSQL 17.11, builds m=main, a=main+#190001, b=main+#190129, ab=main+both.
Order m a b ab ab b a m, twice (4 runs per build). Each run: fresh DB from template and fresh Gateway home, 20 s warmup at 4 clients, then closed-loop chat.history at 1/8/16/32 clients for 45 s each, pg_stat_statements per arm, idle scrapes at 10/45/100 s.
Files: medians.tsv (median of 4 runs per build and arm), arms.tsv (per run and arm), memory.tsv (per run RSS, transcript worker heap, backends), pgss.tsv (statements per call), run-order-and-load.txt (1-minute load at each run start; the host was shared).
idle300 columns were not sampled in this bench (shown as 0 or empty).
memory-medians.tsv: median of the 4 runs per build for the memory.tsv columns quoted in the PR body.
worker-time.tsv: history worker (sessionTranscript) time per worker request from the Prometheus scrapes before and after each arm, per run and median of 4 runs.
Load: run-order-and-load.txt has the 1-minute load when each run started; arms.tsv has load1_start and load1_end per arm (includes the arm's own Gateway work).
tests/: gate logs on the same main (PostgreSQL conformance with this PR, with both PRs and red on plain main; unit; check:changed, whose only failure is the dead export scan with the same 86 entries as plain main, see deadcode-exports-*.log). Bench work-directory paths are replaced with <bench>.
