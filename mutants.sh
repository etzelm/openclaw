#!/bin/bash
# Mutation check at the head: each mutant changes one line of query-reader.ts; the new
# scheduling and shared-compute tests must fail on every one.
export PATH="$HOME/homebrew/bin:$PATH"
cd ~/work/oss-166304 || exit 1
E=~/work/oss-166304-r4
F=extensions/memory-wiki/src/query-reader.ts
T="extensions/memory-wiki/src/query-scheduling.test.ts extensions/memory-wiki/src/query-shared-compute.test.ts"
mkdir -p "$E/mutants"
run_mut() { name=$1; python3 -c "$2" || { echo "$name: patch failed"; return; }; git diff -- "$F" > "$E/mutants/$name.diff"; pnpm test $T 2>&1 | sed 's/\x1b\[[0-9;]*m//g' > "$E/mutants/$name.log"; echo "$name: $(grep -E 'Tests ' "$E/mutants/$name.log")"; grep -E "×" "$E/mutants/$name.log" | sed 's/.*> //'; git checkout -- "$F"; }
{
  echo "HEAD=$(git rev-parse HEAD) $(date -u +%Y-%m-%dT%H:%M:%SZ)"; git status --short
  run_mut M1-merge-order-reversed 'import pathlib;p=pathlib.Path("'$F'");s=p.read_text();o="sortWikiSearchResults([...results, ...read.results])";assert s.count(o)==1;p.write_text(s.replace(o,"sortWikiSearchResults([...read.results, ...results])"))'
  run_mut M2-one-unbatched-task 'import pathlib,re;p=pathlib.Path("'$F'");s=p.read_text();n=re.subn(r"const WIKI_SCAN_BATCH_PAGES = \d+;","const WIKI_SCAN_BATCH_PAGES = Number.POSITIVE_INFINITY;",s);assert n[1]==1;p.write_text(n[0])'
  run_mut M3-parallel-batches 'import pathlib;p=pathlib.Path("'$F'");s=p.read_text()
o="""    let results: WikiSearchResult[] = [];
    for (const batch of scanBatches(relativePaths)) {
      const { query, mode, maxResults } = task;
      const read = await runPoolTask(
        { select: "search", rootDir, visibility, relativePaths: batch, query, mode, maxResults },
        signal,
      );"""
assert s.count(o)==1
n="""    let results: WikiSearchResult[] = [];
    const { query, mode, maxResults } = task;
    const reads = await Promise.all(
      [...scanBatches(relativePaths)].map((batch) =>
        runPoolTask(
          { select: "search", rootDir, visibility, relativePaths: batch, query, mode, maxResults },
          signal,
        ),
      ),
    );
    for (const read of reads) {"""
p.write_text(s.replace(o,n))'
  git status --short; echo MUTANTS DONE
} > "$E/mutants/mutants-run.log" 2>&1
