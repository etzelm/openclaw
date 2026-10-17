# Summary (all numbers quoted from the named files; times are microseconds per search through the built searchKeywordWithFallback)

| quantity | store | value | source file |
|---|---|---|---|
| us/search BEFORE, protocol median of 10 rep means | dev (6,012 chunks) | 1239.9 | timing-dev.out |
| us/search AFTER, protocol median of 10 rep means | dev (6,012 chunks) | 1111.4 | timing-dev.out |
| saving us and percent, protocol | dev (6,012 chunks) | 128.5 us (10.4 percent) | timing-dev.out |
| round 1 medians before/after | dev (6,012 chunks) | 1198.4 / 1126.0 | timing-dev.out |
| round 2 medians before/after | dev (6,012 chunks) | 1311.6 / 1096.2 | timing-dev.out |
| load1 at start of the 4 protocol runs | dev (6,012 chunks) | 7.85, 7.85, 7.95, 7.95 | timing-dev.out |
| supplemental 8 runs (ABBA ABBA) before/after, median of 20 rep means | dev (6,012 chunks) | 1173.3 / 1001.9, saving 171.4 us (14.6 percent) | timing-dev.out |
| combined protocol + supplemental (30 rep means per arm) | dev (6,012 chunks) | 1196.0 / 1027.9, saving 168.1 us (14.1 percent) | timing-dev.out |
| parity (sha256 of full result object) | dev (6,012 chunks) | 20/20 identical; body rows 227, path rows 49 | parity-dev.out |
| plans identical vs different (statements) | dev (6,012 chunks) | 80/80 identical, 0 different; 4 statement shapes | plans-dev.out |
| memory_index_chunks READ callbacks per search, searches 1-10 BEFORE | dev (6,012 chunks) | 86 86 43 43 43 43 43 43 43 43 | compiles-dev.out |
| memory_index_chunks READ callbacks per search, searches 1-10 AFTER | dev (6,012 chunks) | 43 43 0 0 0 0 0 0 0 0 | compiles-dev.out |
| db.function registrations per search, searches 1-10 BEFORE | dev (6,012 chunks) | 3 3 3 3 3 3 3 3 3 3 | compiles-dev.out |
| db.function registrations per search, searches 1-10 AFTER | dev (6,012 chunks) | 2 0 0 0 0 0 0 0 0 0 | compiles-dev.out |
| us/search BEFORE, protocol median of 10 rep means | main (43,634 chunks) | 3950.9 | timing-main.out |
| us/search AFTER, protocol median of 10 rep means | main (43,634 chunks) | 3618.8 | timing-main.out |
| saving us and percent, protocol | main (43,634 chunks) | 332.1 us (8.4 percent) | timing-main.out |
| round 1 medians before/after | main (43,634 chunks) | 4068.1 / 3553.7 | timing-main.out |
| round 2 medians before/after | main (43,634 chunks) | 3872.1 / 3702.0 | timing-main.out |
| load1 at start of the 4 protocol runs | main (43,634 chunks) | 7.87, 7.72, 7.66, 7.21 | timing-main.out |
| supplemental 8 runs (ABBA ABBA) before/after, median of 20 rep means | main (43,634 chunks) | 3656.7 / 3515.6, saving 141.2 us (3.9 percent) | timing-main.out |
| combined protocol + supplemental (30 rep means per arm) | main (43,634 chunks) | 3698.9 / 3537.7, saving 161.2 us (4.4 percent) | timing-main.out |
| parity (sha256 of full result object) | main (43,634 chunks) | 20/20 identical; body rows 408, path rows 148 | parity-main.out |
| plans identical vs different (statements) | main (43,634 chunks) | 80/80 identical, 0 different; 4 statement shapes | plans-main.out |
| memory_index_chunks READ callbacks per search, searches 1-10 BEFORE | main (43,634 chunks) | 86 86 43 43 43 43 43 43 43 43 | compiles-main.out |
| memory_index_chunks READ callbacks per search, searches 1-10 AFTER | main (43,634 chunks) | 43 43 0 0 0 0 0 0 0 0 | compiles-main.out |
| db.function registrations per search, searches 1-10 BEFORE | main (43,634 chunks) | 3 3 3 3 3 3 3 3 3 3 | compiles-main.out |
| db.function registrations per search, searches 1-10 AFTER | main (43,634 chunks) | 2 0 0 0 0 0 0 0 0 0 | compiles-main.out |
| us/search BEFORE, protocol median of 10 rep means | synthetic unicode61 (3,030) | 2452.0 | synthetic-unicode61.out |
| us/search AFTER, protocol median of 10 rep means | synthetic unicode61 (3,030) | 2215.7 | synthetic-unicode61.out |
| saving us and percent, protocol | synthetic unicode61 (3,030) | 236.2 us (9.6 percent) | synthetic-unicode61.out |
| round 1 medians before/after | synthetic unicode61 (3,030) | 2455.2 / 2215.9 | synthetic-unicode61.out |
| round 2 medians before/after | synthetic unicode61 (3,030) | 2448.7 / 2215.6 | synthetic-unicode61.out |
| load1 at start of the 4 protocol runs | synthetic unicode61 (3,030) | 5.14, 4.97, 4.73, 4.51 | synthetic-unicode61.out |
| parity (sha256 of full result object) | synthetic unicode61 (3,030) | 20/20 identical; body rows 360, path rows 198 | synthetic-unicode61.out |
| plans identical vs different (statements) | synthetic unicode61 (3,030) | 101/101 identical, 0 different; 12 statement shapes | synthetic-unicode61.out |
| memory_index_chunks READ callbacks per search, searches 1-10 BEFORE | synthetic unicode61 (3,030) | 86 86 43 43 43 43 43 43 43 43 | synthetic-unicode61.out |
| memory_index_chunks READ callbacks per search, searches 1-10 AFTER | synthetic unicode61 (3,030) | 43 43 0 0 0 0 0 0 0 0 | synthetic-unicode61.out |
| db.function registrations per search, searches 1-10 BEFORE | synthetic unicode61 (3,030) | 3 3 3 3 3 3 3 3 3 3 | synthetic-unicode61.out |
| db.function registrations per search, searches 1-10 AFTER | synthetic unicode61 (3,030) | 2 0 0 0 0 0 0 0 0 0 | synthetic-unicode61.out |
| us/search BEFORE, protocol median of 10 rep means | synthetic trigram (3,030) | 3501.3 | synthetic-trigram.out |
| us/search AFTER, protocol median of 10 rep means | synthetic trigram (3,030) | 3357.6 | synthetic-trigram.out |
| saving us and percent, protocol | synthetic trigram (3,030) | 143.8 us (4.1 percent) | synthetic-trigram.out |
| round 1 medians before/after | synthetic trigram (3,030) | 3481.7 / 3373.8 | synthetic-trigram.out |
| round 2 medians before/after | synthetic trigram (3,030) | 3526.6 / 3320.5 | synthetic-trigram.out |
| load1 at start of the 4 protocol runs | synthetic trigram (3,030) | 4.39, 4.36, 4.22, 4.04 | synthetic-trigram.out |
| parity (sha256 of full result object) | synthetic trigram (3,030) | 20/20 identical; body rows 336, path rows 198 | synthetic-trigram.out |
| plans identical vs different (statements) | synthetic trigram (3,030) | 90/90 identical, 0 different; 18 statement shapes | synthetic-trigram.out |
| memory_index_chunks READ callbacks per search, searches 1-10 BEFORE | synthetic trigram (3,030) | 86 86 43 43 43 43 43 43 43 43 | synthetic-trigram.out |
| memory_index_chunks READ callbacks per search, searches 1-10 AFTER | synthetic trigram (3,030) | 43 43 0 0 0 0 0 0 0 0 | synthetic-trigram.out |
| db.function registrations per search, searches 1-10 BEFORE | synthetic trigram (3,030) | 3 3 3 3 3 3 3 3 3 3 | synthetic-trigram.out |
| db.function registrations per search, searches 1-10 AFTER | synthetic trigram (3,030) | 2 0 0 0 0 0 0 0 0 0 | synthetic-trigram.out |

Other files: params.md (derivations, connection method), dist-diff.out (built-code diff), env.out (machine, versions), scripts (measure-search.mjs, lib.mjs, resolve-dist.mjs, gen-synthetic-store.mjs, drive-*.sh, run-aux.sh, report.mjs, summary.mjs, probe-open.mjs), raw/ (per-run JSON and logs; no row content).

## Additional numbers (source: raw/*-compiles-*.json, tabulated in compiles-*.out and synthetic-*.out)
- Real stores (dev, main), 60 searches = 3 passes over the 20 inputs: memory_index_chunks READ callbacks BEFORE 2580 (43 per search), AFTER 0; db.function registrations BEFORE 180 (3 per search), AFTER 0 (2 in the first 10-search run) (compiles-dev.out, compiles-main.out).
- Synthetic unicode61, 60 searches: callbacks BEFORE 3647 (pass 1 1309, pass 2 1197, pass 3 1141), AFTER 224 (pass 1 168, pass 2 56, pass 3 0) (synthetic-unicode61.out totals line; per-pass sums from raw/synthetic-unicode61-compiles-*.json).
- Synthetic trigram, 60 searches: callbacks BEFORE 3236 (pass 1 1202, pass 2 1060, pass 3 974), AFTER 314 (pass 1 228, pass 2 86, pass 3 0) (synthetic-trigram.out totals line; per-pass sums from raw/synthetic-trigram-compiles-*.json).
- Connection: the agent read-only opener refuses the schema 24 copies; both arms used the built openSqliteReadOnlyDatabase plus built enableNodeSqliteKyselyStatementCache (params.md, probe-open.mjs).
- Protocol timing runs happened at load1 about 7.2 to 10.7 (dev, main) after one 660 s wait; supplemental runs at load1 about 3.4 to 3.6.
