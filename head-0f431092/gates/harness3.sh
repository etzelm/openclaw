#!/bin/bash
# Harness rerun with the synthetic claude writing its transcript under CLAUDE_CONFIG_DIR (as real Claude does).
G=~/work/merge-164796-gates; S=$G/summary-harness3.txt
while pgrep -f "check-changed|check:changed" >/dev/null; do sleep 30; done
cd ~/work/merge-164796; echo "HEAD $(git rev-parse HEAD) TREE $(git rev-parse HEAD^{tree}) dirty=$(git status --porcelain | wc -l | tr -d ' ')" > $S
echo "child change: $(diff ~/work/pr-164796-h/claude.r15.orig ~/work/pr-164796-h/harness/bin/claude | tr "\n" " ")" >> $S; echo "probe change: $(diff ~/work/pr-164796-h/gateway-probe.r15.orig ~/work/pr-164796-h/harness/gateway-probe.sh | tr "\n" " ")" >> $S
bash ~/work/pr-164796-h/run-after.sh > $G/harness3-run.out 2>&1; echo "harness run-after EXIT $?" >> $S
bash ~/work/pr-164796-h/run-upgrade.sh > $G/harness3-upgrade.out 2>&1; echo "harness run-upgrade EXIT $?" >> $S
diff ~/work/pr-164796-h/ref/outcomes-after.txt ~/work/pr-164796-h/logs/outcomes-after.txt > $G/harness3-outcomes.diff 2>&1; echo "harness outcomes raw diff vs r15 EXIT $? ($(wc -l < $G/harness3-outcomes.diff | tr -d ' ') lines)" >> $S
echo DONE >> $S
