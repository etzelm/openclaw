#!/bin/bash
# After driver.sh: attribute the src/config/sessions/ lane failure
# (session-history-archive-pruning.admission.test.ts, "database is locked" in seedFreePages).
export PATH=$HOME/homebrew/bin:$PATH
W=~/work/pr-164796-m5; D=$W/.m5; P=$D/pristine; O=$D/gates/followup; mkdir -p $O; S=$O/summary.txt
while [ ! -f $D/driver.done ]; do sleep 30; done
F=src/config/sessions/session-history-archive-pruning.admission.test.ts
ld() { uptime | sed 's/.*averages: //'; }
line() { sed 's/\x1b\[[0-9;]*m//g' "$1" | grep -E "Tests  |^ FAIL |database is locked" | head -3 | tr '\n' ' '; }
echo "start $(date) merge=$(git -C $W rev-parse HEAD) pristine=$(git -C $P rev-parse HEAD)" > $S
cd $W
for i in 1 2 3; do OPENCLAW_VITEST_MAX_WORKERS=4 pnpm test $F > $O/merge-alone-$i.log 2>&1; echo "merge alone $i exit=$? load=$(ld) $(line $O/merge-alone-$i.log)" >> $S; done
cd $P
for i in 1 2 3; do OPENCLAW_VITEST_MAX_WORKERS=4 pnpm test $F > $O/pristine-alone-$i.log 2>&1; echo "pristine alone $i exit=$? load=$(ld) $(line $O/pristine-alone-$i.log)" >> $S; done
cd $W
echo "merge lane start load=$(ld)" >> $S
OPENCLAW_VITEST_MAX_WORKERS=8 pnpm test src/config/sessions/ > $O/merge-lane-rerun.log 2>&1; echo "merge lane rerun exit=$? load=$(ld) $(sed 's/\x1b\[[0-9;]*m//g' $O/merge-lane-rerun.log | grep -E 'Test Files |Tests  |^ FAIL ' | tr '\n' ' ')" >> $S
cd $P
echo "pristine lane start load=$(ld)" >> $S
OPENCLAW_VITEST_MAX_WORKERS=8 pnpm test src/config/sessions/ > $O/pristine-lane.log 2>&1; echo "pristine lane exit=$? load=$(ld) $(sed 's/\x1b\[[0-9;]*m//g' $O/pristine-lane.log | grep -E 'Test Files |Tests  |^ FAIL ' | tr '\n' ' ')" >> $S
echo "end $(date)" >> $S
echo done > $O/done
