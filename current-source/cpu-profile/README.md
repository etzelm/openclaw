CPU profiles of the history (session transcript) worker threads at 8 clients, main 82210a2bbdb0 (m) vs main + this PR (a).

Method: same bench as pair-bench/ (fresh DB from template and fresh Gateway home per run, 20 s warmup at 4 clients,
45 s closed-loop chat.history at 8 clients), with NODE_OPTIONS="--cpu-prof" so every worker thread writes a V8 CPU
profile. Order m a m a (profrun.sh). Only profiles whose code includes session-transcript.worker are counted.
profcmp.py sums self and inclusive time per function and divides by the transcript worker request count of the same
runs (openclaw_worker_request_seconds_count{kind="sessionTranscript"} after the 8-client arm, warmup included).

Files: profcmp-all.txt (2 runs per build), profcmp-pair1.txt (m-1 vs a-2), profcmp-pair2.txt (m-3 vs a-4),
runs-h8.txt (latency of each profiled run), run-order-and-load.txt (1-minute load at run start).

Profiling slows every build (p50 26.8 to 28.9 ms vs 19.7 to 20.8 ms unprofiled in pair-bench/), so read the
differences, not the absolute values.

Result (profcmp-all.txt, microseconds per worker request, a minus m):
- busy +123.2 (2946.0 vs 3069.1); pair 1 +131.5, pair 2 +114.8.
- bridge wait on the same statements: self time in `request` +61.9, inclusive `query` +62.6.
- garbage collection +10.5.
- everything else is spread thinly: no other function moves by more than 6.
- the held snapshot's own open and close (beginPostgresReadOnlyTransaction 81.2, endSnapshotHold 62.5 inclusive) are
  mostly bridge round trips for BEGIN and ROLLBACK, which main also sends once per page; main's matching frames are
  not broken out here, so this does not show whether they cost more.
- statement counts per call are the same on both builds (pair-bench/pgss.tsv), so the extra wait is per round trip,
  not more round trips. The data here does not separate database time from bridge transport time.
