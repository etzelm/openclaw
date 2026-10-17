# Timings: wall ms of the whole `memory search "memory" --json --agent <id> --max-results 25` process, observer OFF, interleaved base/patched, 5 runs each

Blocks: seal-N = in place on one sealed working state per arm with config N (state already synced by step 4); seal-M = in place on the sealed pristine state (data unchanged, 43490 or 6012 chunks) with config M; noseal-N and noseal-M = each run on its own fresh cp -c -R -p of state-migrated-pristine (no seal exists in pristine; a cloned seal is not honored, so seal path runs are in place). gate-noproof=true means the integrity gate ran (no usable seal).

## store dev

```
# dev start gateway-procs=0 uptime: 8:07  up 5 days, 7 mins, 1 user, load averages: 25.21 20.29 13.77
## block seal-N uptime before: 8:07  up 5 days, 7 mins, 1 user, load averages: 25.21 20.29 13.77
dev seal-N run 1 base exit=0 ms=5841.6 gate-noproof=false
dev seal-N run 1 patched exit=0 ms=5731.5 gate-noproof=false
dev seal-N run 2 base exit=0 ms=4831.3 gate-noproof=false
dev seal-N run 2 patched exit=0 ms=4383.1 gate-noproof=false
dev seal-N run 3 base exit=0 ms=4336.6 gate-noproof=false
dev seal-N run 3 patched exit=0 ms=4276.2 gate-noproof=false
dev seal-N run 4 base exit=0 ms=4427.9 gate-noproof=false
dev seal-N run 4 patched exit=0 ms=4171.8 gate-noproof=false
dev seal-N run 5 base exit=0 ms=4270.3 gate-noproof=false
dev seal-N run 5 patched exit=0 ms=4213.8 gate-noproof=false
## block seal-N uptime after: 8:07  up 5 days, 7 mins, 1 user, load averages: 21.49 20.27 14.15
RAW dev seal-N base=[5841.6,4831.3,4336.6,4427.9,4270.3] patched=[5731.5,4383.1,4276.2,4171.8,4213.8] median_base=4427.9 median_patched=4276.2
## block seal-M uptime before: 8:07  up 5 days, 7 mins, 1 user, load averages: 21.49 20.27 14.15
dev seal-M run 1 base exit=0 ms=7967.4 gate-noproof=false
dev seal-M run 1 patched exit=0 ms=7780 gate-noproof=false
dev seal-M run 2 base exit=0 ms=8021.5 gate-noproof=false
dev seal-M run 2 patched exit=0 ms=7948.2 gate-noproof=false
dev seal-M run 3 base exit=0 ms=7682.6 gate-noproof=false
dev seal-M run 3 patched exit=0 ms=7708 gate-noproof=false
dev seal-M run 4 base exit=0 ms=7622.5 gate-noproof=false
dev seal-M run 4 patched exit=0 ms=8228.3 gate-noproof=false
dev seal-M run 5 base exit=0 ms=7438.9 gate-noproof=false
dev seal-M run 5 patched exit=0 ms=7562.8 gate-noproof=false
## block seal-M uptime after: 8:09  up 5 days, 9 mins, 1 user, load averages: 18.66 19.59 14.40
RAW dev seal-M base=[7967.4,8021.5,7682.6,7622.5,7438.9] patched=[7780,7948.2,7708,8228.3,7562.8] median_base=7682.6 median_patched=7780
## block noseal-N uptime before: 8:09  up 5 days, 9 mins, 1 user, load averages: 18.66 19.59 14.40
dev noseal-N run 1 base exit=0 ms=10557.9 gate-noproof=true
dev noseal-N run 1 patched exit=0 ms=10553.1 gate-noproof=true
dev noseal-N run 2 base exit=0 ms=10726.8 gate-noproof=true
dev noseal-N run 2 patched exit=0 ms=9961.2 gate-noproof=true
dev noseal-N run 3 base exit=0 ms=10096.2 gate-noproof=true
dev noseal-N run 3 patched exit=0 ms=11419.7 gate-noproof=true
dev noseal-N run 4 base exit=0 ms=10154.8 gate-noproof=true
dev noseal-N run 4 patched exit=0 ms=10514 gate-noproof=true
dev noseal-N run 5 base exit=0 ms=10329.3 gate-noproof=true
dev noseal-N run 5 patched exit=0 ms=10438.5 gate-noproof=true
## block noseal-N uptime after: 8:10  up 5 days, 11 mins, 1 user, load averages: 10.16 16.57 13.84
RAW dev noseal-N base=[10557.9,10726.8,10096.2,10154.8,10329.3] patched=[10553.1,9961.2,11419.7,10514,10438.5] median_base=10329.3 median_patched=10514
## block noseal-M uptime before: 8:10  up 5 days, 11 mins, 1 user, load averages: 10.16 16.57 13.84
dev noseal-M run 1 base exit=0 ms=10376.5 gate-noproof=true
dev noseal-M run 1 patched exit=0 ms=10236.6 gate-noproof=true
dev noseal-M run 2 base exit=0 ms=10657.7 gate-noproof=true
dev noseal-M run 2 patched exit=0 ms=10441.2 gate-noproof=true
dev noseal-M run 3 base exit=0 ms=10257.9 gate-noproof=true
dev noseal-M run 3 patched exit=0 ms=10599.5 gate-noproof=true
dev noseal-M run 4 base exit=0 ms=10854.1 gate-noproof=true
dev noseal-M run 4 patched exit=0 ms=10768.8 gate-noproof=true
dev noseal-M run 5 base exit=0 ms=10709.7 gate-noproof=true
dev noseal-M run 5 patched exit=0 ms=10375.6 gate-noproof=true
## block noseal-M uptime after: 8:12  up 5 days, 12 mins, 1 user, load averages: 6.34 13.15 12.82
RAW dev noseal-M base=[10376.5,10657.7,10257.9,10854.1,10709.7] patched=[10236.6,10441.2,10599.5,10768.8,10375.6] median_base=10657.7 median_patched=10441.2
# dev end gateway-procs=0
```

## store main

```
# main start gateway-procs=0 uptime: 8:12  up 5 days, 12 mins, 1 user, load averages: 6.34 13.15 12.82
## block seal-N uptime before: 8:12  up 5 days, 12 mins, 1 user, load averages: 6.34 13.15 12.82
main seal-N run 1 base exit=0 ms=7489.9 gate-noproof=false
main seal-N run 1 patched exit=0 ms=6371.6 gate-noproof=false
main seal-N run 2 base exit=0 ms=4665.4 gate-noproof=false
main seal-N run 2 patched exit=0 ms=4733.5 gate-noproof=false
main seal-N run 3 base exit=0 ms=4637.5 gate-noproof=false
main seal-N run 3 patched exit=0 ms=4644 gate-noproof=false
main seal-N run 4 base exit=0 ms=4616.7 gate-noproof=false
main seal-N run 4 patched exit=0 ms=4642.1 gate-noproof=false
main seal-N run 5 base exit=0 ms=4694.3 gate-noproof=false
main seal-N run 5 patched exit=0 ms=4615.4 gate-noproof=false
## block seal-N uptime after: 8:13  up 5 days, 13 mins, 1 user, load averages: 5.93 12.02 12.42
RAW main seal-N base=[7489.9,4665.4,4637.5,4616.7,4694.3] patched=[6371.6,4733.5,4644,4642.1,4615.4] median_base=4665.4 median_patched=4644
## block seal-M uptime before: 8:13  up 5 days, 13 mins, 1 user, load averages: 5.93 12.02 12.42
main seal-M run 1 base exit=0 ms=11931.3 gate-noproof=false
main seal-M run 1 patched exit=0 ms=11047.2 gate-noproof=false
main seal-M run 2 base exit=0 ms=6577 gate-noproof=false
main seal-M run 2 patched exit=0 ms=6819.4 gate-noproof=false
main seal-M run 3 base exit=0 ms=6526.2 gate-noproof=false
main seal-M run 3 patched exit=0 ms=6741.7 gate-noproof=false
main seal-M run 4 base exit=0 ms=6597 gate-noproof=false
main seal-M run 4 patched exit=0 ms=6539.7 gate-noproof=false
main seal-M run 5 base exit=0 ms=6681.3 gate-noproof=false
main seal-M run 5 patched exit=0 ms=6994.8 gate-noproof=false
## block seal-M uptime after: 8:14  up 5 days, 14 mins, 1 user, load averages: 4.10 10.11 11.66
RAW main seal-M base=[11931.3,6577,6526.2,6597,6681.3] patched=[11047.2,6819.4,6741.7,6539.7,6994.8] median_base=6597 median_patched=6819.4
## block noseal-N uptime before: 8:14  up 5 days, 14 mins, 1 user, load averages: 4.10 10.11 11.66
main noseal-N run 1 base exit=0 ms=32069 gate-noproof=true
main noseal-N run 1 patched exit=0 ms=29631.3 gate-noproof=true
main noseal-N run 2 base exit=0 ms=29534 gate-noproof=true
main noseal-N run 2 patched exit=0 ms=28983.2 gate-noproof=true
main noseal-N run 3 base exit=0 ms=29033.9 gate-noproof=true
main noseal-N run 3 patched exit=0 ms=29547.6 gate-noproof=true
main noseal-N run 4 base exit=0 ms=29733.9 gate-noproof=true
main noseal-N run 4 patched exit=0 ms=29158.8 gate-noproof=true
main noseal-N run 5 base exit=0 ms=32968.1 gate-noproof=true
main noseal-N run 5 patched exit=0 ms=32542.2 gate-noproof=true
## block noseal-N uptime after: 8:19  up 5 days, 20 mins, 1 user, load averages: 3.60 6.13 9.33
RAW main noseal-N base=[32069,29534,29033.9,29733.9,32968.1] patched=[29631.3,28983.2,29547.6,29158.8,32542.2] median_base=29733.9 median_patched=29547.6
## block noseal-M uptime before: 8:19  up 5 days, 20 mins, 1 user, load averages: 3.60 6.13 9.33
main noseal-M run 1 base exit=0 ms=29201.6 gate-noproof=true
main noseal-M run 1 patched exit=0 ms=31874.3 gate-noproof=true
main noseal-M run 2 base exit=0 ms=30718.3 gate-noproof=true
main noseal-M run 2 patched exit=0 ms=32137.5 gate-noproof=true
main noseal-M run 3 base exit=0 ms=30985.8 gate-noproof=true
main noseal-M run 3 patched exit=0 ms=32381 gate-noproof=true
main noseal-M run 4 base exit=0 ms=30784.3 gate-noproof=true
main noseal-M run 4 patched exit=0 ms=32138.4 gate-noproof=true
main noseal-M run 5 base exit=0 ms=31704.3 gate-noproof=true
main noseal-M run 5 patched exit=0 ms=32183.9 gate-noproof=true
## block noseal-M uptime after: 8:25  up 5 days, 25 mins, 1 user, load averages: 2.17 3.75 7.23
RAW main noseal-M base=[29201.6,30718.3,30985.8,30784.3,31704.3] patched=[31874.3,32137.5,32381,32138.4,32183.9] median_base=30784.3 median_patched=32138.4
# main end gateway-procs=0
```

