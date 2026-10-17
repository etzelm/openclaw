#!/bin/bash
# usage: run-aux.sh   -> parity, compiles, plans for both arms on dev, main, synthetic-unicode61, synthetic-trigram
P=<scratch>/prod; W=<home>/work
cd $P
for s in synthetic-unicode61 synthetic-trigram; do for arm in before after; do cp -f stores/$s.sqlite stores/$s-$arm.sqlite; done; done
for s in dev main synthetic-unicode61 synthetic-trigram; do
  extra=""; tok=unicode61
  case $s in synthetic-*) extra="--queries synthetic --queries-file $P/synthetic-queries.json"; tok=${s#synthetic-};; esac
  for mode in parity compiles plans; do
    for arm in before after; do
      if [ $arm = before ]; then ROOT=$W/t1-01-search-prepare-main; else ROOT=$W/t1-01-search-prepare; fi
      node measure-search.mjs $ROOT stores/$s-$arm.sqlite $mode --tokenizer $tok $extra --out raw/$s-$mode-$arm.json || echo "FAIL $s $mode $arm"
    done
  done
  echo "done $s"
done
echo "EXIT 0"
