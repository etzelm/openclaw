# ClawSweeper roleplay pre-review, round 3 (rebased onto fd3a2122b95)

Read: rubric notes, pr.diff, PR-BODY.md, round2.md, and from evidence-rebased/: README.md, provenance.txt, aggregate.out, timing-paired.out, build/dist-probe.txt, gates/RA-head.txt, RA-hygiene.log, RA-changed-lanes.log, runs/measure.log; grep on RA-tests, RA-red-base, RA-related, RA-lane, RA-check-changed; summary.txt and transcript heads of after-W3-dev-obs, after-W3-dev-r2-1, and the W2/main obs summaries. Nothing was run.

## Verdict

ACCEPT WITH EDITS (one small wording edit; no code or evidence change needed). The round 2 defects (session group admission mis-described, test case 2 not reaching the byte budget, #175608 overlap) are closed. Numbers all trace.

Predicted: Overall platinum hermit 4/6 (about 65%; gold shrimp 3/6 about 30%, mostly product-cap variance; above 4/6 about 5%). Proof 4/6 (shipped built-dist CLI on both arms, observer, parity, head per run). Patch quality 4/6.

## 1. Maintainer-decision trigger

No config, default, schema, permission, public API or stored-encoding change, no feature, and no linked-issue expectation is contradicted, so I expect `worthIt: yes` (about 80%) and `fixScope: not_applicable`. The only text that could be read as raising an owner question:

- Gaps: "that is a separate question for the memory owners and is not proposed here." This tells the reviewer an owner decision is pending, and can be read as "waiting on an owner" (a cap at C). It is not needed; the same limit is already stated in "Why This Change Was Made" ("changes that private format and is a separate change"). See MUST-FIX 1.
- `Related: #164773, #175608` (no closing keyword). #164773 is the author's own merged PR, not an issue, and there is no linked issue to define "partial", so fixScope should be not_applicable. Low risk, but the relation is unstated (NICE 1).

"the storage review checkpoint does not apply" is a factual negative with reasons; fine.

## 2. Shipped-entry-point grade

Yes on both arms. Real `openclaw memory index --agent <id> --force --verbose` via `node <arm>/openclaw.mjs` in `env -i`, followed by `memory status --json` and `memory search`. build/dist-probe.txt: base head fd3a2122b95e, porcelain 0, build-info commit fd3a2122b95e, `publicationProbes` 0, build exit 0; change head da23f8b0772f, porcelain 0, build-info commit da23f8b0772f, `publicationProbes` 4, exit 0. provenance.txt ties change da23f8b0772 to tree a951e871ee13 (also gates/RA-head.txt), and the body names that tree. Transcripts carry `arm=after head=da23f8b0772faa3c... dirty_files=0`. aggregate.out: 48 runs, no failed exits, one base head and one after head, `# parity mismatches: 0`. Real stores (430,518,272 and 4,855,853,056 bytes with sha256) plus a no-store cell. The only stand-in is the loopback embedding stub, which the body discloses.

One reviewer-visible caveat: the pushed signed commit will have a different SHA than da23f8b0772 if the parent re-signs; the body keys on the tree, which is the right anchor. Keep tree equality true at push time (NICE 2).

## 3. Number trace (28 checked, 0 mismatches)

- Counters table, all 3 cells, calls, coords and chars, BEFORE and AFTER (18 values): match aggregate.out lines 32-37 exactly (e.g. 94,952 to 48,600; 48,615,424 to 24,883,200; 1,040,333,030 to 532,482,115; 81,968 to 56,168; 898,083,302 to 615,405,005; 2,464 to 2,272; 26,994,989 to 24,891,149).
- 15.6, 11.7, 8.7 per chunk: match. 532,482,115 / 6,075 = 87,650 chars per vector: correct.
- Timing table W3 dev r2: 15.7 to 12.9, 48.4 to 43.8, 44.6 to 40.6 s; r1: 16.6 to 14.2, 51.0 to 48.8, 51.9 to 49.1; W2 r1 3.2 to 2.2, 8.6 to 7.5, 7.3 to 5.5; W2 r2 2.4 to 2.3, 8.0 to 7.8, 6.3 to 5.9; main 15.2 to 13.1, 60.7 to 55.4, 57.0 to 52.1: all match timing-paired.out and aggregate.out.
- Paired differences: r1 -3.0, -2.4, +1.3, -2.4, -2.4 and r2 -5.1, +0.6, -2.1, -2.5, -3.2: match timing-paired.out. Pooled 16.0 to 13.0: match. "round 1 run 3: AFTER wall 88.3 s against 65.8 s": match (88,263 vs 65,789). "dev store wall from 36.9 to 88.5 s": match (36,946 and 88,513).
- Load: W3 r1 8.8 to 47.4, W2 r1 14.5 to 24.6, W2 r2 16.1 to 24.0, main (15.8, 8.4), observed 22.3 to 53.3: match measure.log. W3 r2 "4.4 to 20.4" matches timing-paired.out (transcript load), while Gaps "4.2 to 47.4" matches measure.log (4.22). Both are sourced; see NICE 3.
- Rows: 6,075/6,044/6,075, 7,021/7,010/7,021, 284/284/284: match the worker insert lines in the obs summary.txt files. Parity hashes and row counts (a4982293f36e3180, ebe55dd99b88df93, 50b511076f364476, 448a42cfd37aa993, 66acd7386feb1be1, 0269459b66ef8593, 88fc680e794ebc20, 3569a10987c29246, ce4f547038d953e5; 6,410 / 50,000 / 284): match aggregate.out lines 40-42.
- Worker parse chars (1,656,046,468 to 1,656,046,613; 1,873,899,946 to 1,873,900,100; 74,330,436 to 74,329,302) and per-number calls (24,318,844 to 24,301,462; 28,246,135 to 28,236,460; 1,149,953 to 1,149,881): match.
- Tests: 27 passed (2 files), 84 passed (7 files), 101 passed | 4 skipped (105) and 916 passed | 23 skipped (939), 2411/801/936/2 ms, 46.77 s shard, 42.37 s duration, transform 79%: match RA-tests, RA-related, RA-lane. Red: 164 vs 28, 736 vs 244, 5368 vs 4292, 3 failed: match RA-red-base.log.
- Diff shape: 126 + 24 + 74 + 12 = 236 added; removed 5 + 1 = 6; production 86/6 matches provenance.txt. Lanes: extensions and extensionTests true, rest false: match. RA-hygiene: diff --check exit 0, oxfmt clean, 0 dashes: match. check:changed: exit 1, failed max-lines suppression ratchet and dead export scan only; line-cap, SQLite worker and mock-export ratchets ok; 0 warnings 0 errors: match.

## 4. Correctness

Sound. Probe keyed on `chunks` array, reused only if source, retained, removedIds and every embedding vector are the same objects; the embeddings array is snapshotted by copy so later mutation of the array is detected. Header rebuilt per call. Staged: head plus unread generator consumed once, then cleared, so a failed staged attempt and its retry reprints fresh rather than replaying a spent generator; a post-consumption `memoryPublicationInline` returns undefined (still "too large"), same answer as before. `finally` release covers success and failure, captures the group members before preparation can splice the array, and runs after retry closures finish, so SQLITE_BUSY retries reuse the print. Releasing after a failed group only costs a reprint when members are republished singly, never staleness. Memory: probes are in a WeakMap keyed on chunks (value referencing key is fine for ephemerons); worst case is probed-but-never-published sources keeping at most two printed batches (staged) or one inline print (budgeted) until the prepared array drops. Interaction with #175608: retained and removedIds are compared by identity for every source, so memory-file deltas never reuse a print across a different delta (round 2 S3 resolved). Residual, unfalsifiable from the diff: in-place mutation of a chunk row or vector object between admission and write would not be detected (identity only); the manager builds fresh replacement objects rather than mutating, and stored-vector assertions in the tests pass, so this is theoretical.

## 5. Body standard

No em or en dashes (grep clean); no local paths or hostnames ("Mac Studio" is a hardware model; acceptable); Title line first, Related line second; Gaps is last. Evidence line placeholder is expected. Evidence is long, as the standard wants. No process narration found.

## MUST-FIX

1. Remove the owner-question wording (only product-cap trigger). In Gaps, replace
   "Note: removing those would need the vectors to cross the worker as bytes, which changes the private host/worker message format; that is a separate question for the memory owners and is not proposed here."
   with
   "Removing those would need the vectors to cross the worker as bytes, which changes the private host/worker message format. That is a separate change and is not part of this one."

## NICE-TO-HAVE

1. State the Related relation: change line 3 to "Related: #164773 (earlier vector-scoring change in the same memory publication area), #175608 (delta publication of memory sources, which this builds on)". Round 1 and 2 raised this and it is still bare. (If #164773 is not clearly related, drop it.)
2. At push time confirm the pushed tree is still a951e871ee1; if the signed commit differs, keep the body keyed to the tree and not to the SHA da23f8b0772.
3. Unify the W3 dev round 2 load: use "(4.2 to 20.4)" in the timing table row (measure.log, 4.22) or "4.4" in Gaps. Both are sourced today, but the two figures differ for the same run.
4. Evidence preamble: "(production files identical to this commit)" is cryptic. Replace with "on this change's tree `a951e871ee1`, base `fd3a2122b95` (after #175608)".
5. Optional Gaps line on residual risk: "Reuse is by object identity of the source, retained rows, removed ids and each vector; the manager does not mutate these between admission and write, which was read from the code and is not asserted by a test."
