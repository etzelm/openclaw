# checks-ui-e2e (1/2) on 9edd6cbabc1: main's failure, fixed on main

PR run 42968871634, job 130352904677 (`gh run view --job 130352904677 --log`):
  FAIL ui/src/e2e/activity-denial-refresh.real-gateway.e2e.test.ts:33 > Activity denial real Gateway >
       keeps a real guest timeline denial stable across unrelated session mutations
  TimeoutError: locator.waitFor: Timeout 30000ms exceeded, waiting for '.activity-feed__feedback [role=alert]' (line 137)
  Test Files 1 failed | 22 passed (23); Tests 1 failed | 66 passed (67). Excerpt: pr-job-130352904677-failure.txt

Same test, same assertion, without this PR:
- Run 42965770035, job 130343116189, checks-ui-e2e (1/4), checkout 386d148f061: the run #197058 cites as its
  "actual failing CI leaf" (main parent 0d0ab362b22). Log: same FAIL line at :33, Test Files 1 failed | 24 passed (25).
- Cause (#197058 body): #196446 removed the blanket foreign-person denial; #196939 then added this real-Gateway
  scenario that still expects the removed error, so the alert never appears.
- Fix on main: #197058, commit d04c6ab44ad "test(ui): retire obsolete foreign Activity denial scenario",
  merged 2026-11-11T06:18:52Z, after the PR run started (05:56Z). It deletes the test file (-193 lines) and
  lowers its allocation. `git merge-base --is-ancestor d04c6ab44ad 9edd6cbabc1` -> false (not in the head).
- This PR changes no file under ui/ and none the test imports (PR diff: 29 files, src/infra, src/snapshot,
  src/cli/update-cli, src/config, docs, config/test-lines-allocations).
- Main's push CI skips checks-ui-e2e (run 42966385353 at 577da8a944e: job skipped), so main's push runs look green.
Any later merge of main into the PR picks up d04c6ab44ad and removes the failing file.
