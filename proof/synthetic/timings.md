# Timings (wall ms of the whole CLI process, observer OFF, interleaved base/patched)

Host was busy (load average ~23 throughout); differences below are within noise unless stated.

## Seal path (receipt reconcile)

| run | base ms | patched ms |
|---|---|---|
| 1 | 4179.9 | 4062.1 |
| 2 | 4246.3 | 4068.2 |
| 3 | 4040.8 | 4097.2 |
| 4 | 4032.2 | 4103.9 |
| 5 | 4138.7 | 3959.8 |
| median | 4138.7 | 4068.2 |

## No-seal path (first admission, fresh pristine copy each run)

| run | base ms | patched ms |
|---|---|---|
| 1 | 4236.4 | 4196.6 |
| 2 | 4463.4 | 4313.9 |
| 3 | 4157.7 | 4112.6 |
| 4 | 4087.6 | 4145.2 |
| 5 | 4179.6 | 4073.9 |
| median | 4179.6 | 4145.2 |

## uptime before/after

```
seal before:  7:07  up 4 days, 23:07, 1 user, load averages: 23.60 24.95 20.83
seal after:  7:08  up 4 days, 23:08, 1 user, load averages: 22.75 24.73 20.94
noseal before:  7:08  up 4 days, 23:08, 1 user, load averages: 22.75 24.73 20.94
noseal after:  7:09  up 4 days, 23:09, 1 user, load averages: 18.81 23.41 20.65
```
