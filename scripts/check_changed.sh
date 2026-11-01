#!/bin/sh
export LC_ALL=en_US.UTF-8 LANG=en_US.UTF-8 CI=1
W=$HOME/work/pg-r2-l3c; mkdir -p $W/redgreen
cd $W/src-fix && pnpm check:changed --base 6e36a0b85b4 > $W/redgreen/check-changed.log 2>&1; echo "CHECK_CHANGED rc=$? $(date)" | tee -a $W/redgreen/check-changed.log
