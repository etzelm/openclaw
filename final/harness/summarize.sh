#!/bin/bash
# usage: summarize.sh <label> <scenario>
H=$HOME/work/164796-harness
R=$H/runs/$1-$2
echo "######## $1 / $2"
cat $R/turns.log | grep -E "^(turn|===)" | sed 's/^--- //'
for f in $R/turn*.err; do
  n=$(basename $f .err)
  echo "[$n openclaw log]"
  grep -E "cli exec:|history refused|CLI history|authority changed|Error|error" $f | sed -e 's/^\[agent\/cli-backend\] //'
done
echo "[fake claude child records]"
sed -e "s#$R#\$RUN#g" $R/fake-claude.log
echo "[prompt canaries per user message]"
for p in $R/fake-claude.log.user-*.txt; do
  [ -f "$p" ] || continue
  echo "$(basename $p | sed 's/fake-claude.log.//'): chars=$(wc -c < $p | tr -d ' ') PINEAPPLE-7=$(grep -c 'PINEAPPLE-7' $p) BANANA-3=$(grep -c 'BANANA-3' $p)"
done
