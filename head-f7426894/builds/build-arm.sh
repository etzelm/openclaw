#!/bin/bash
# usage: build-arm.sh before|after
set -u
S=$SCRATCH
WT=~/.claude/repos/openclaw-pr-178929
F=src/plugin-sdk/provider-auth-claude-compat.ts
OUT=$S/pr178929/e2e/builds/$1
mkdir -p $OUT
export PATH=$S/upstream/node24bin:$PATH
until mkdir $S/upstream/test.lock 2>/dev/null; do sleep 20; done
trap 'rmdir $S/upstream/test.lock 2>/dev/null' EXIT
cd $WT
if [ "$1" = before ]; then git show origin/main:$F > $F; fi
git status --short > $OUT/status-during.txt
git diff --stat >> $OUT/status-during.txt
node --version > $OUT/node.txt
pnpm build > $OUT/build.log 2>&1; echo $? > $OUT/build.exit
if [ "$1" = before ]; then git checkout -- $F; fi
git status --short > $OUT/status-after.txt
git rev-parse HEAD HEAD^{tree} >> $OUT/status-after.txt
rmdir $S/upstream/test.lock
trap - EXIT
echo built > $OUT/DONE
