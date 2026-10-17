#!/bin/sh
# usage: inspect.sh <S> <label>
export PATH=$HOME/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin
S=$1; L=$2; D=$S/state/agents/main/agent/openclaw-agent.sqlite; I=$S/inspect/$L; rm -rf $I; mkdir -p $I
for s in "" -wal -shm; do [ -f $D$s ] && cp $D$s $I/openclaw-agent.sqlite$s; done
node <scratch>/tools/counts.mjs $I/openclaw-agent.sqlite > $S/logs/counts-$L.out 2>$S/logs/counts-$L.err; cat $S/logs/counts-$L.out $S/logs/counts-$L.err
