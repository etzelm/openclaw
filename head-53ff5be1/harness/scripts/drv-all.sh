#!/bin/bash
cd ~/work/m4-harness || exit 1
mkdir -p out
./drv-run-after.sh; echo "after exit=$?" > out/drv.txt
./drv-run-upgrade.sh; echo "upgrade exit=$?" >> out/drv.txt
./drv-run-upgrade-1005.sh; echo "upgrade-1005 exit=$?" >> out/drv.txt
echo done > out/done
