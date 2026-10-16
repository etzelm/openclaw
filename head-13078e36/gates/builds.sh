#!/bin/bash
export PATH=$HOME/homebrew/bin:$PATH
G=~/work/pr-164796-gates
cd ~/work/pr-164796 && pnpm build > $G/build-final.log 2>&1; echo "BUILDEXIT $?" >> $G/build-final.log
git -C ~/work/pr-164796 worktree add -q ~/work/pr-164796-main gh/main > $G/main-worktree.log 2>&1
cd ~/work/pr-164796-main && pnpm install --frozen-lockfile > $G/main-install.log 2>&1 && pnpm build > $G/build-base.log 2>&1; echo "BUILDEXIT $?" >> $G/build-base.log
echo "BUILDS DONE" >> $G/builds-done.txt
