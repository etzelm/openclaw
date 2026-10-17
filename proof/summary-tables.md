
### before/c1 (counting observer)

pids 53741, threads 13,19, authorizer installs 2, total fn registrations in whole run 90, events outside any call window: {}

| step | method | exit | wall ms | fn regs | search prepares | search runs | run us (sum) | compile episodes (all) | compiles (READ memory_index_chunks) | auth callbacks | episodes in prepare | episodes in run |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| status | memory.status | 0 | 3778 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| s01 | memory.search | 0 | 763 | 3 | 4 | 4 | 3909.6 | 8 | 8 | 270 | 4 | 4 |
| s02 | memory.search | 0 | 758 | 3 | 4 | 4 | 4345.5 | 8 | 8 | 258 | 4 | 4 |
| s03 | memory.search | 0 | 756 | 3 | 0 | 4 | 4197.3 | 4 | 4 | 147 | 0 | 4 |
| s04 | memory.search | 0 | 750 | 3 | 0 | 4 | 4389.6 | 4 | 4 | 147 | 0 | 4 |
| s05 | memory.search | 0 | 777 | 3 | 0 | 4 | 4489 | 4 | 4 | 147 | 0 | 4 |
| s06 | memory.search | 0 | 758 | 3 | 0 | 4 | 4319 | 4 | 4 | 147 | 0 | 4 |
| s07 | memory.search | 0 | 747 | 3 | 0 | 4 | 4262.4 | 4 | 4 | 147 | 0 | 4 |
| s08 | memory.search | 0 | 767 | 3 | 0 | 4 | 4057.8 | 4 | 4 | 147 | 0 | 4 |
| s09 | memory.search | 0 | 756 | 3 | 0 | 4 | 4198.9 | 4 | 4 | 147 | 0 | 4 |
| s10 | memory.search | 0 | 746 | 3 | 0 | 4 | 4177.9 | 4 | 4 | 147 | 0 | 4 |
| s11 | memory.search | 0 | 753 | 3 | 0 | 4 | 4197.3 | 4 | 4 | 147 | 0 | 4 |
| s12 | memory.search | 0 | 768 | 3 | 0 | 4 | 4206.6 | 4 | 4 | 147 | 0 | 4 |
| s13 | memory.search | 0 | 756 | 3 | 0 | 4 | 4103.7 | 4 | 4 | 147 | 0 | 4 |
| s14 | memory.search | 0 | 744 | 3 | 0 | 4 | 4414.7 | 4 | 4 | 147 | 0 | 4 |
| s15 | memory.search | 0 | 746 | 3 | 0 | 4 | 4256.8 | 4 | 4 | 147 | 0 | 4 |
| s16 | memory.search | 0 | 732 | 3 | 0 | 4 | 4583.8 | 4 | 4 | 147 | 0 | 4 |
| s17 | memory.search | 0 | 750 | 3 | 0 | 4 | 4244.5 | 4 | 4 | 147 | 0 | 4 |
| s18 | memory.search | 0 | 745 | 3 | 0 | 4 | 4280.6 | 4 | 4 | 147 | 0 | 4 |
| s19 | memory.search | 0 | 734 | 3 | 0 | 4 | 4439.4 | 4 | 4 | 147 | 0 | 4 |
| s20 | memory.search | 0 | 719 | 3 | 0 | 4 | 4387 | 4 | 4 | 147 | 0 | 4 |
| s21 | memory.search | 0 | 758 | 3 | 0 | 4 | 4073.3 | 4 | 4 | 147 | 0 | 4 |
| s22 | memory.search | 0 | 760 | 3 | 0 | 4 | 4154.7 | 4 | 4 | 147 | 0 | 4 |
| s23 | memory.search | 0 | 699 | 3 | 0 | 4 | 4034.8 | 4 | 4 | 147 | 0 | 4 |
| s24 | memory.search | 0 | 711 | 3 | 0 | 4 | 4186.8 | 4 | 4 | 147 | 0 | 4 |
| s25 | memory.search | 0 | 731 | 3 | 0 | 4 | 4137.9 | 4 | 4 | 147 | 0 | 4 |
| s26 | memory.search | 0 | 900 | 3 | 0 | 4 | 4708.7 | 4 | 4 | 147 | 0 | 4 |
| s27 | memory.search | 0 | 720 | 3 | 0 | 4 | 4036.6 | 4 | 4 | 147 | 0 | 4 |
| s28 | memory.search | 0 | 771 | 3 | 0 | 4 | 4183.4 | 4 | 4 | 147 | 0 | 4 |
| s29 | memory.search | 0 | 718 | 3 | 0 | 4 | 4161.4 | 4 | 4 | 147 | 0 | 4 |
| s30 | memory.search | 0 | 715 | 3 | 0 | 4 | 4271.1 | 4 | 4 | 147 | 0 | 4 |

Totals over 30 searches: fn regs 90, prepares 8, runs 120, compiles 128, episodes 128, callbacks 4644, run us 127410. Requests 11-30: fn 60, prepares 0, compiles 80, episodes 80, callbacks 2940.

### after/c1 (counting observer)

pids 54838, threads 13,19, authorizer installs 2, total fn registrations in whole run 2, events outside any call window: {}

| step | method | exit | wall ms | fn regs | search prepares | search runs | run us (sum) | compile episodes (all) | compiles (READ memory_index_chunks) | auth callbacks | episodes in prepare | episodes in run |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| status | memory.status | 0 | 894 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| s01 | memory.search | 0 | 737 | 2 | 4 | 4 | 23263.3 | 6 | 4 | 153 | 4 | 2 |
| s02 | memory.search | 0 | 700 | 0 | 4 | 4 | 20480.7 | 5 | 4 | 116 | 4 | 1 |
| s03 | memory.search | 0 | 746 | 0 | 0 | 4 | 13147 | 1 | 0 | 5 | 0 | 1 |
| s04 | memory.search | 0 | 687 | 0 | 0 | 4 | 9839.2 | 1 | 0 | 5 | 0 | 1 |
| s05 | memory.search | 0 | 691 | 0 | 0 | 4 | 8812 | 1 | 0 | 5 | 0 | 1 |
| s06 | memory.search | 0 | 695 | 0 | 0 | 4 | 4026 | 1 | 0 | 5 | 0 | 1 |
| s07 | memory.search | 0 | 680 | 0 | 0 | 4 | 3674.7 | 1 | 0 | 5 | 0 | 1 |
| s08 | memory.search | 0 | 695 | 0 | 0 | 4 | 3845.2 | 1 | 0 | 5 | 0 | 1 |
| s09 | memory.search | 0 | 688 | 0 | 0 | 4 | 4014.3 | 1 | 0 | 5 | 0 | 1 |
| s10 | memory.search | 0 | 689 | 0 | 0 | 4 | 4304.1 | 1 | 0 | 5 | 0 | 1 |
| s11 | memory.search | 0 | 695 | 0 | 0 | 4 | 3850.2 | 1 | 0 | 5 | 0 | 1 |
| s12 | memory.search | 0 | 685 | 0 | 0 | 4 | 3706.8 | 1 | 0 | 5 | 0 | 1 |
| s13 | memory.search | 0 | 697 | 0 | 0 | 4 | 3862.7 | 1 | 0 | 5 | 0 | 1 |
| s14 | memory.search | 0 | 684 | 0 | 0 | 4 | 3844.6 | 1 | 0 | 5 | 0 | 1 |
| s15 | memory.search | 0 | 681 | 0 | 0 | 4 | 3847.3 | 1 | 0 | 5 | 0 | 1 |
| s16 | memory.search | 0 | 755 | 0 | 0 | 4 | 3969.2 | 1 | 0 | 5 | 0 | 1 |
| s17 | memory.search | 0 | 690 | 0 | 0 | 4 | 3696.1 | 1 | 0 | 5 | 0 | 1 |
| s18 | memory.search | 0 | 695 | 0 | 0 | 4 | 3868 | 1 | 0 | 5 | 0 | 1 |
| s19 | memory.search | 0 | 697 | 0 | 0 | 4 | 3873.9 | 1 | 0 | 5 | 0 | 1 |
| s20 | memory.search | 0 | 704 | 0 | 0 | 4 | 3981.8 | 1 | 0 | 5 | 0 | 1 |
| s21 | memory.search | 0 | 703 | 0 | 0 | 4 | 3750.8 | 1 | 0 | 5 | 0 | 1 |
| s22 | memory.search | 0 | 664 | 0 | 0 | 4 | 3639.6 | 1 | 0 | 5 | 0 | 1 |
| s23 | memory.search | 0 | 672 | 0 | 0 | 4 | 3643.8 | 1 | 0 | 5 | 0 | 1 |
| s24 | memory.search | 0 | 670 | 0 | 0 | 4 | 3904.7 | 1 | 0 | 5 | 0 | 1 |
| s25 | memory.search | 0 | 682 | 0 | 0 | 4 | 3904.2 | 1 | 0 | 5 | 0 | 1 |
| s26 | memory.search | 0 | 671 | 0 | 0 | 4 | 3862.7 | 1 | 0 | 5 | 0 | 1 |
| s27 | memory.search | 0 | 683 | 0 | 0 | 4 | 3662.9 | 1 | 0 | 5 | 0 | 1 |
| s28 | memory.search | 0 | 712 | 0 | 0 | 4 | 4227 | 1 | 0 | 5 | 0 | 1 |
| s29 | memory.search | 0 | 803 | 0 | 0 | 4 | 6377.6 | 1 | 0 | 5 | 0 | 1 |
| s30 | memory.search | 0 | 729 | 0 | 0 | 4 | 3878.1 | 1 | 0 | 5 | 0 | 1 |

Totals over 30 searches: fn regs 2, prepares 8, runs 120, compiles 8, episodes 39, callbacks 409, run us 174759. Requests 11-30: fn 0, prepares 0, compiles 0, episodes 20, callbacks 100.

### timing-only runs (no authorizer, no EQP): summed search-statement run microseconds per request

| run | median req 11-30 (us) | median req 1-10 (us) | mean 11-30 (us) | fn regs total | prepares 11-30 | raw (30 values, us) |
|---|---|---|---|---|---|---|
| before/t1 | 4047.6 | 4079.8 | 4233.5 | 90 | 0 | 4058.9 3733.1 4217.2 4360.9 4611.6 4220.2 4011.9 4029.3 4054.2 4100.7 4344 3881 3904.8 4031.3 4119.2 3925.3 3788.8 3526.4 8117 4183.1 4063.9 4057.5 3977.7 4320.1 4243.3 3986 3638.7 4216.6 4037.7 4308.2 |
| before/t2 | 4085.7 | 7218.2 | 4099.6 | 90 | 0 | 31965.6 20595.2 16898.5 11957.7 9969 4359.5 4467.4 4168.7 4144.2 4200.5 4222.3 3857.4 4096.1 4291.5 4159.3 4119.9 4043.3 4216.1 4117.8 4489.8 4199.4 4044.5 3924.2 4049.8 4024.2 3989.6 3839.8 3946.4 4075.3 4286 |
| after/t1 | 3922.1 | 3859.8 | 3972.4 | 2 | 0 | 3556.7 3769 3906 4208.8 4164 3620 3598.6 3813.5 3928 3935.1 5907.8 3936.2 3733.9 4015.8 3973.7 4001.9 3517.7 3832.5 3908 4001.3 3855.2 3835.9 3475.3 4086.8 4038.5 3804.1 3792.5 3599.6 3955.9 4176.4 |
| after/t2 | 3772.8 | 3911.3 | 3784.1 | 2 | 0 | 6049.4 3911.7 3977.8 3970.6 4082.5 3855.2 3760.9 3910.9 3825.6 3792.7 3815.9 3838.1 3681.1 4015.3 3764.3 3801 3684.1 3627.8 3833.9 3811.7 3726.6 3669 3733.7 4059.1 3728.2 3709.9 3641.4 3781.2 3872.8 3887.9 |
