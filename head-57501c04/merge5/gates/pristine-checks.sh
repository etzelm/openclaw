#!/bin/bash
# After followup.sh: the two failed check:changed checks on pristine main at the merged SHA.
export PATH=$HOME/homebrew/bin:$PATH
W=~/work/pr-164796-m5; D=$W/.m5; P=$D/pristine; O=$D/gates/pristine; mkdir -p $O; S=$O/checks.txt
while [ ! -f $D/gates/followup/done ]; do sleep 30; done
MAIN=051bf6fa4d05e0870d0f360aee7ac1643cbb787d
cd $P || exit 1
echo "pristine HEAD $(git rev-parse HEAD) tree $(git rev-parse 'HEAD^{tree}') $(date)" > $S
node --import ./scripts/tsx.mjs scripts/check-max-lines-ratchet.mts --base $MAIN > $O/max-lines-ratchet.log 2>&1; echo "pristine max-lines ratchet exit=$?" >> $S
node --import ./scripts/tsx.mjs scripts/check-tsgo-core-boundary.mts > $O/tsgo-core-boundary.log 2>&1; echo "pristine tsgo core boundary exit=$?" >> $S
cd $W
node --import ./scripts/tsx.mjs scripts/check-tsgo-core-boundary.mts > $O/merge-tsgo-core-boundary.log 2>&1; echo "merge tsgo core boundary exit=$?" >> $S
echo "ui identical to main: $(git diff --quiet $MAIN HEAD -- ui/ && echo yes || echo no)" >> $S
echo "test/tsconfig identical to main: $(git diff --quiet $MAIN HEAD -- test/tsconfig/ && echo yes || echo no)" >> $S
echo "test files added by the merge vs main: $(git diff --name-only --diff-filter=A $MAIN HEAD | grep -cE '\.test\.tsx?$')" >> $S
git diff --name-only --diff-filter=A $MAIN HEAD >> $S
echo done > $O/checks.done
