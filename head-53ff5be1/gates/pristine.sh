#!/bin/bash
cd ~/work/pr-164796-merge4 || exit 1
export PATH=$HOME/homebrew/bin:$PATH
G=.m4/gates/pristine; mkdir -p $G
MAIN=79506514289f3d51342af165dc0f6f9c0638a40b
F=src/config/sessions/session-accessor.sqlite-archive-read.test.ts
echo "load $(uptime)" > $G/summary.txt
OPENCLAW_VITEST_MAX_WORKERS=4 pnpm test $F > $G/merged-archive-read-alone-1.log 2>&1; echo "merged alone 1 exit=$?" >> $G/summary.txt
OPENCLAW_VITEST_MAX_WORKERS=4 pnpm test $F > $G/merged-archive-read-alone-2.log 2>&1; echo "merged alone 2 exit=$? load $(uptime | sed 's/.*averages: //')" >> $G/summary.txt
git worktree add -q --detach .m4/pristine $MAIN > $G/worktree.log 2>&1; echo "worktree exit=$?" >> $G/summary.txt
cd .m4/pristine || exit 1
for d in $(cd ~/work/pr-164796-merge4 && find . -name node_modules -type d -prune -not -path './.m4/*' | sed 's|^\./||'); do [ -e "$d" ] || { mkdir -p "$(dirname "$d")"; ln -s ~/work/pr-164796-merge4/$d $d; }; done
echo "pristine HEAD $(git rev-parse HEAD) tree $(git rev-parse 'HEAD^{tree}')" >> ../gates/pristine/summary.txt
G=../gates/pristine
node --import ./scripts/tsx.mjs scripts/check-max-lines-ratchet.mts --base $MAIN > $G/max-lines-ratchet.log 2>&1; echo "pristine max-lines ratchet exit=$?" >> $G/summary.txt
node --import ./scripts/tsx.mjs scripts/check-tsgo-core-boundary.mts > $G/tsgo-core-boundary.log 2>&1; echo "pristine tsgo core boundary exit=$?" >> $G/summary.txt
node --import tsx scripts/check-deadcode-exports.mts > $G/deadcode.log 2>&1; echo "pristine deadcode exit=$?" >> $G/summary.txt
OPENCLAW_VITEST_MAX_WORKERS=4 pnpm test $F > $G/pristine-archive-read-alone.log 2>&1; echo "pristine archive-read alone exit=$? load $(uptime | sed 's/.*averages: //')" >> $G/summary.txt
echo done > $G/done
