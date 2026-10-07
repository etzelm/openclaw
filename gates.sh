#!/bin/bash
export PATH="$HOME/homebrew/bin:$PATH"
cd ~/work/oss-166304
E=~/work/oss-166304-evidence
mkdir -p $E
{
  echo "=== git"; git rev-parse HEAD; git status --short; date
  echo "=== pnpm vitest run extensions/memory-wiki/"
  pnpm vitest run extensions/memory-wiki/ 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | tee $E/tests.log | grep -E '×|FAIL|Test Files|Tests |Duration' | tail -20
  echo "=== pnpm check:changed --base origin/main"; date
  pnpm check:changed --base origin/main 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | tee $E/check-changed.log | tail -40
  echo "check:changed exit=${PIPESTATUS[0]}"
  echo "=== git diff --check"; git diff --check origin/main HEAD && echo "diff --check clean"
  echo "=== pnpm changed:lanes --json"; date
  pnpm changed:lanes --json --base origin/main 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | tee $E/changed-lanes.json | tail -60
  echo "=== per-file test cost (pnpm test <file> --maxWorkers=1)"; date
  for f in extensions/memory-wiki/src/query.reads.test.ts extensions/memory-wiki/src/query-reader.test.ts extensions/memory-wiki/src/query.abort.test.ts extensions/memory-wiki/index.test.ts extensions/memory-wiki/src/query.test.ts extensions/memory-wiki/src/apply.test.ts; do
    echo "--- $f"
    /usr/bin/time -p pnpm test "$f" --maxWorkers=1 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E 'Test Files|Tests |Duration|^real|^user|FAIL|×' | tail -8
  done
  date; echo "EXIT=0"
} > ~/work/oss-166304-gates.log 2>&1
cp ~/work/oss-166304-gates.log $E/gates.log
touch ~/work/oss-166304-gates.done
