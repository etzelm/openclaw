#!/bin/bash
export NO_COLOR=1 FORCE_COLOR=0
T=extensions/memory-core/src/memory/manager-search.test.ts
C=<scratch>/t1-01-ev/cost
cd <scratch>/t1-01-search-prepare && pnpm test $T > /dev/null 2>&1
cd <scratch>/t1-01-search-prepare-main && pnpm test $T > /dev/null 2>&1
n=0
for arm in base branch branch base; do
  n=$((n+1))
  if [ $arm = branch ]; then cd <scratch>/t1-01-search-prepare; else cd <scratch>/t1-01-search-prepare-main; fi
  { echo "# run $n arm $arm $(git rev-parse --short HEAD) load before: $(sysctl -n vm.loadavg)"; echo "\$ pnpm test $T --maxWorkers=1"; /usr/bin/time -p pnpm test $T --maxWorkers=1; echo "EXIT $?"; echo "# load after: $(sysctl -n vm.loadavg)"; } > $C/cost-$n-$arm.out 2>&1
done
cd <scratch>/t1-01-search-prepare
{ echo "# load before: $(sysctl -n vm.loadavg)"; echo "\$ pnpm test extensions/memory-core/src/memory"; /usr/bin/time -p pnpm test extensions/memory-core/src/memory; echo "EXIT $?"; echo "# load after: $(sysctl -n vm.loadavg)"; } > $C/owning-dir.out 2>&1
echo DONE > $C/done
