#!/bin/bash
# Compare this run's harness outcomes with round 2's (148b78f9f4a), turn-2 client exit code of interrupted-* rows masked (1 vs 143 race), outcomes script sed stderr dropped.
G=~/work/pr-164796-merge3-gates; R=~/work/pr-164796-h/ref
n() { sed -E 's/^(interrupted-[a-z-]+ \| exit=[0-9]+ )exit=(1|143) /\1exit=RACE /' "$1" | grep -v "^sed: "; }
for ref in outcomes-after.round2-148b78f9.txt outcomes-after.txt outcomes-after.prevmerge.txt; do
  n $R/$ref > $G/.m-ref; n $G/outcomes-after.txt > $G/.m-new
  diff $G/.m-ref $G/.m-new > /dev/null && echo "vs $ref: identical after masking ($(wc -l < $G/.m-new | tr -d ' ') lines)" || { echo "vs $ref DIFFERS"; diff $G/.m-ref $G/.m-new | head -20; }
done
rm -f $G/.m-ref $G/.m-new
