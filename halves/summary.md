# Summary: half-patched builds vs BASE vs FULL (all numbers from the named files; <scratch> = scratch dir)

Steady-state per search = median over searches 21-60 of the 60-search run (compiles-<store>.out); search 10 values in tables-<store>.out.

## real dev store (6,012 chunks)

| arm | memory_index_chunks compile reads per steady-state search | db.function per search | total callbacks per search | FTS5 shadow-table callbacks per search | timing | saving | parity vs BASE | source |
|---|---|---|---|---|---|---|---|---|
| BASE | 43 | 3 | 160 | 33 | skipped | skipped | 20/20 | compiles-dev.out, tables-dev.out, timing-dev.out, parity-dev.out |
| M1 | 43 | 0 | 116 | 0 | skipped | skipped | 20/20 | compiles-dev.out, tables-dev.out, timing-dev.out, parity-dev.out |
| M2 | 43 | 6 | 160 | 33 | skipped | skipped | 20/20 | compiles-dev.out, tables-dev.out, timing-dev.out, parity-dev.out |
| FULL | 0 | 0 | 5 | 0 | skipped | skipped | 20/20 | compiles-dev.out, tables-dev.out, timing-dev.out, parity-dev.out |

memory_index_chunks reads, searches 1-10 (compiles-dev.out first10): BASE: 86 86 43 43 43 43 43 43 43 43; M1: 86 86 43 43 43 43 43 43 43 43; M2: 43 43 43 43 43 43 43 43 43 43; FULL: 43 43 0 0 0 0 0 0 0 0

60-search totals (compiles-dev.out): BASE C=2580 F=180 T=9327; M1 C=2580 F=0 T=6960; M2 C=2580 F=360 T=9327; FULL C=0 F=0 T=300

Search 10 (tables-dev.out): BASE total 147, shadow 23, data_version 3, F 3; M1 total 116, shadow 0, data_version 0, F 0; M2 total 147, shadow 23, data_version 3, F 6; FULL total 5, shadow 0, data_version 0, F 0

Timing: see timing-dev.out (skipped, load1 above 15).

## real main store (43,634 chunks)

| arm | memory_index_chunks compile reads per steady-state search | db.function per search | total callbacks per search | FTS5 shadow-table callbacks per search | timing | saving | parity vs BASE | source |
|---|---|---|---|---|---|---|---|---|
| BASE | 43 | 3 | 160 | 33 | skipped | skipped | 20/20 | compiles-main.out, tables-main.out, timing-main.out, parity-main.out |
| M1 | 43 | 0 | 116 | 0 | skipped | skipped | 20/20 | compiles-main.out, tables-main.out, timing-main.out, parity-main.out |
| M2 | 43 | 6 | 160 | 33 | skipped | skipped | 20/20 | compiles-main.out, tables-main.out, timing-main.out, parity-main.out |
| FULL | 0 | 0 | 5 | 0 | skipped | skipped | 20/20 | compiles-main.out, tables-main.out, timing-main.out, parity-main.out |

memory_index_chunks reads, searches 1-10 (compiles-main.out first10): BASE: 86 86 43 43 43 43 43 43 43 43; M1: 86 86 43 43 43 43 43 43 43 43; M2: 43 43 43 43 43 43 43 43 43 43; FULL: 43 43 0 0 0 0 0 0 0 0

60-search totals (compiles-main.out): BASE C=2580 F=180 T=9600; M1 C=2580 F=0 T=6960; M2 C=2580 F=360 T=9600; FULL C=0 F=0 T=300

Search 10 (tables-main.out): BASE total 160, shadow 33, data_version 3, F 3; M1 total 116, shadow 0, data_version 0, F 0; M2 total 160, shadow 33, data_version 3, F 6; FULL total 5, shadow 0, data_version 0, F 0

Timing: see timing-main.out (skipped, load1 above 15).

