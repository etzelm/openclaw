#!/bin/bash
# Mutation check at the head: each mutant changes one construct; the changed test files
# must fail on every one.
export PATH="$HOME/homebrew/bin:$PATH"
cd ~/work/oss-166304 || exit 1
E=~/work/oss-166304-r4
S=extensions/memory-wiki/src
T="$S/query-scheduling.test.ts $S/query-shared-compute.test.ts $S/query-reader.test.ts"
mkdir -p "$E/mutants"
run_mut() { name=$1; file=$2; old=$3; new=$4
  OLD="$old" NEW="$new" python3 -c 'import os,pathlib,sys;p=pathlib.Path(sys.argv[1]);s=p.read_text();o=os.environ["OLD"];assert s.count(o)==1,o;p.write_text(s.replace(o,os.environ["NEW"]))' "$file" || { echo "$name: patch failed"; return; }
  git diff -- "$file" > "$E/mutants/$name.diff"
  pnpm test $T 2>&1 | sed 's/\x1b\[[0-9;]*m//g' > "$E/mutants/$name.log"
  echo "$name: $(grep -E 'Tests ' "$E/mutants/$name.log")"; grep -E "×" "$E/mutants/$name.log" | sed 's/.*> //'
  git checkout -- "$file"; }
{
  echo "HEAD=$(git rev-parse HEAD) $(date -u +%Y-%m-%dT%H:%M:%SZ)"; git status --short
  run_mut M1-segment-merge-reversed $S/query-pages.ts 'sortWikiSearchResults([...results, ...found])' 'sortWikiSearchResults([...found, ...results])'
  run_mut M2-task-merge-reversed $S/query-reader.ts 'sortWikiSearchResults([...results, ...read.results])' 'sortWikiSearchResults([...read.results, ...results])'
  run_mut M3-host-never-yields $S/query-reader.ts 'input: yieldSignal.aborted ? WIKI_SCAN_YIELD : null,' 'input: null,'
  run_mut M4-worker-ignores-yield $S/query-reader.worker.ts 'return reply.input === WIKI_SCAN_YIELD;' 'return false;'
  run_mut M5-no-lookup-recheck $S/query-reader.ts 'const current = page && resolveQueryableWikiPageByLookup([page], task.lookup);' 'const current = page;'
  git status --short; echo MUTANTS DONE
} > "$E/mutants/mutants-run.log" 2>&1
