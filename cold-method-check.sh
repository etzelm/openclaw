#!/bin/bash
# Validate F_NOCACHE cold copies on the dev store. Usage: cold-method-check.sh <settled-source.sqlite> <scratch-dir>
S=$1; W=$2; D=$(dirname "$0")
uptime
python3 -I $D/cold-copy.py $S $W/chk-nocache.sqlite
echo "(a) fresh F_NOCACHE copy, first sequential read:"; python3 -I $D/read-time.py $W/chk-nocache.sqlite
echo "(b) same file, read again immediately:"; python3 -I $D/read-time.py $W/chk-nocache.sqlite
rm -f $W/chk-nocache.sqlite
cp $S $W/chk-cp.sqlite
echo "(c) fresh normal cp copy, first sequential read:"; python3 -I $D/read-time.py $W/chk-cp.sqlite
echo "(c2) normal cp copy, read again:"; python3 -I $D/read-time.py $W/chk-cp.sqlite
rm -f $W/chk-cp.sqlite
uptime
# Random-page supplement (sequential reads on this NVMe are ~cache speed, so they cannot discriminate).
S=$1; W=$2
python3 -I $D/cold-copy.py $S $W/chk-nocache.sqlite
echo "(a') fresh F_NOCACHE copy, 20000 random 4 KiB preads, first pass (seed 1):"; python3 -I $D/read-random.py $W/chk-nocache.sqlite 20000 1
echo "(b') same offsets again:"; python3 -I $D/read-random.py $W/chk-nocache.sqlite 20000 1
rm -f $W/chk-nocache.sqlite
cp $S $W/chk-cp.sqlite
echo "(c') fresh normal cp copy, same 20000 offsets, first pass:"; python3 -I $D/read-random.py $W/chk-cp.sqlite 20000 1
rm -f $W/chk-cp.sqlite
uptime
