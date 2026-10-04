#!/bin/bash
# usage: summarize-keychain.sh <label> <scenario>
H=$HOME/work/164796-harness
R=$H/runs/$1-$2
$H/summarize.sh $1 $2 | grep -v '"event":"security-lookup"' | awk '/^\[prompt canaries/{exit} {print}'
echo "[shimmed security lookups per turn: count, kind, mode]"
sed "s#$R#\$RUN#g" $R/fake-claude.log | awk '/^=== /{turn=$0} /"event":"security-lookup"/{match($0,/"kind":"[a-z]+","mode":"[a-z]+"/); c[turn " | " substr($0,RSTART,RLENGTH)]++} END{for(k in c) print c[k], k}' | sort -k2
echo "[prompt canaries per user message]"
$H/summarize.sh $1 $2 | awk 'f{print} /^\[prompt canaries/{f=1}'
