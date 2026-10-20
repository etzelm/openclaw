# Detail moved out of the PR body (verbatim)

## Full state records, BEFORE and AFTER (Security, Memory add-on, Memory engine; source: live-before/ and live-after/)

BEFORE (production files reverted):

```
security-switch-0-focused            active=INPUT[switch]          onControl=true  checked=true  disabled=false aria-disabled=null  opacity=1 cursor=default
security-config-set {"params":{"raw":"{\n  \"browser\": {\n    \"enabled\": false\n  },\n  \"tools\": {\n    \"profile\": \"coding\"\n  }\n}\n","baseHash":"sec-1"}}
security-switch-1-busy               active=BODY                   onControl=false checked=false disabled=true  aria-disabled=null  opacity=0.5 cursor=not-allowed
security-switch-2-space-while-busy   active=BODY                   onControl=false checked=false disabled=true  aria-disabled=null  opacity=0.5 cursor=not-allowed
security-config-set-count-after-space-while-busy {"count":1}
security-switch-3-saved              active=BODY                   onControl=false checked=false disabled=false aria-disabled=null  opacity=1 cursor=default
security-config-set-count-final {"count":1}
memory-switch-0-focused              active=INPUT[switch]          onControl=true  checked=false disabled=false aria-disabled=null  opacity=1 cursor=default
memory-switch-1-busy                 active=BODY                   onControl=false checked=false disabled=true  aria-disabled=null  opacity=0.5 cursor=not-allowed
memory-switch-2-space-while-busy     active=BODY                   onControl=false checked=false disabled=true  aria-disabled=null  opacity=0.5 cursor=not-allowed
memory-setEnabled-requests {"params":[{"pluginId":"active-memory","enabled":true}]}
memory-switch-3-saved                active=BODY                   onControl=false checked=true  disabled=false aria-disabled=null  opacity=1 cursor=default
memory-switch-row-observer {"timeline":["1ms rows=1 switches=1 status=- active=BODY","4ms rows=1 switches=0 status=Disabled active=BODY","7ms rows=1 switches=1 status=- active=BODY"]}
memory-engine-0-focused              active=INPUT[type=radio]      onControl=true  checked=true  disabled=false aria-disabled=null  opacity=1 cursor=default
memory-engine-1-busy                 active=BODY                   onControl=false checked=false disabled=true  aria-disabled=null  opacity=0.5 cursor=not-allowed
memory-engine-2-arrow-while-busy     active=BODY                   onControl=false checked=false disabled=true  aria-disabled=null  opacity=0.5 cursor=not-allowed
memory-engine-writes {"configSet":[],"setEnabled":[{"pluginId":"memory-core","enabled":true}]}
memory-engine-3-saved                active=BODY                   onControl=false checked=true  disabled=false aria-disabled=null  opacity=1 cursor=default
```

AFTER:

```
security-switch-0-focused            active=INPUT[switch]          onControl=true  checked=true  disabled=false aria-disabled=null  opacity=1 cursor=default
security-config-set {"params":{"raw":"{\n  \"browser\": {\n    \"enabled\": false\n  },\n  \"tools\": {\n    \"profile\": \"coding\"\n  }\n}\n","baseHash":"sec-1"}}
security-switch-1-busy               active=INPUT[switch]          onControl=true  checked=false disabled=false aria-disabled=true  opacity=0.5 cursor=not-allowed
security-switch-2-space-while-busy   active=INPUT[switch]          onControl=true  checked=false disabled=false aria-disabled=true  opacity=0.5 cursor=not-allowed
security-config-set-count-after-space-while-busy {"count":1}
security-switch-3-saved              active=INPUT[switch]          onControl=true  checked=false disabled=false aria-disabled=null  opacity=1 cursor=default
security-config-set-count-final {"count":1}
memory-switch-0-focused              active=INPUT[switch]          onControl=true  checked=false disabled=false aria-disabled=null  opacity=1 cursor=default
memory-switch-1-busy                 active=INPUT[switch]          onControl=true  checked=false disabled=false aria-disabled=true  opacity=0.5 cursor=not-allowed
memory-switch-2-space-while-busy     active=INPUT[switch]          onControl=true  checked=false disabled=false aria-disabled=true  opacity=0.5 cursor=not-allowed
memory-setEnabled-requests {"params":[{"pluginId":"active-memory","enabled":true}]}
memory-switch-3-saved                active=BODY                   onControl=false checked=true  disabled=false aria-disabled=null  opacity=1 cursor=default
memory-switch-row-observer {"timeline":["1ms rows=1 switches=1 status=- active=INPUT","6ms rows=1 switches=0 status=Disabled active=BODY","8ms rows=1 switches=1 status=- active=BODY"]}
memory-engine-0-focused              active=INPUT[type=radio]      onControl=true  checked=true  disabled=false aria-disabled=null  opacity=1 cursor=default
memory-engine-1-busy                 active=INPUT[type=radio]      onControl=true  checked=false disabled=false aria-disabled=true  opacity=0.5 cursor=not-allowed
memory-engine-2-arrow-while-busy     active=INPUT[type=radio]      onControl=true  checked=false disabled=false aria-disabled=true  opacity=0.5 cursor=not-allowed
memory-engine-writes {"configSet":[],"setEnabled":[{"pluginId":"memory-core","enabled":true}]}
memory-engine-3-saved                active=INPUT[type=radio]      onControl=true  checked=true  disabled=false aria-disabled=null  opacity=1 cursor=default
```

Per-state `outerHTML`, `ariaSnapshot` and screenshots for every line above are in the attached evidence (`trace.json`).

## Consumer test runs and e2e specs

Changed test files: 17 files, 282 tests, all pass. Consumers, every UI test file that renders these controls or reads a switch (278 files, `pnpm test <files>` in `ui/`):

```
 Test Files  1 failed | 277 passed (278)
      Tests  1 failed | 4135 passed | 1 skipped (4137)
 FAIL   chromium  src/pages/sessions/view.invalidation.browser.test.tsx > retains native label selection and undo without value writes during row metadata refreshes
     Errors  1 error
```

Both are unrelated and identical on base `abf93bd5a1c` alone (a clean checkout of the base, the same 278-file command): `Test Files 1 failed | 277 passed (278)`, `Tests 1 failed | 4131 passed | 1 skipped (4133)` (the four new tests are the difference), the `sessions/view.invalidation` test fails the same way (`expected 'Originalx' to be 'Original'`), and the one unhandled error is the same undici `abortFetch` `TypeError`, attributed to `chat-attachments.test.tsx` in both runs.

e2e on the Settings pages touched here (`updates-settings`, `memory-settings-engine`, `settings-prefs-reconnect`):

```
 ✓  ui-e2e-bundled  ui/src/e2e/updates-settings.e2e.test.ts (6 tests)
 ✓  ui-e2e-bundled  ui/src/e2e/memory-settings-engine.e2e.test.ts (3 tests)
 ✓  ui-e2e-bundled  ui/src/e2e/settings-prefs-reconnect.e2e.test.ts (8 tests)
 Test Files  3 passed (3)
      Tests  17 passed (17)
```

e2e specs that read these switches and radios through Playwright `isDisabled()` / `isEnabled()`, unchanged:

```
 ✓  ui-e2e-bundled  ui/src/e2e/model-defaults-capabilities.e2e.test.ts (2 tests)
 ✓  ui-e2e-bundled  ui/src/e2e/session-progress-preference.e2e.test.ts (1 test)
 ✓  ui-e2e-bundled  ui/src/e2e/session-sources.e2e.test.ts (7 tests)
 ✓  ui-e2e-serial-standalone  ui/src/e2e/presentation-primitives.e2e.test.ts (4 tests)
 Test Files  4 passed (4)
      Tests  14 passed (14)
```

## Greps: code reading native disabled on these controls

CSS rules keyed on the disabled state of these controls (all four are the rules this PR widens), and e2e or test-helper code reading native `disabled` on them (none):

```
$ rg -n "(settings-toggle|settings-segmented|settings-row--toggle)[^{]*(:disabled|\[disabled\]|aria-disabled)" ui/src --glob "*.css"
ui/src/styles/settings-controls.css:193:  > .settings-segmented__btn:is(:disabled, [aria-disabled="true"]),
ui/src/styles/settings-controls.css:194:.settings-toggle:has(input:is(:disabled, [aria-disabled="true"])),
ui/src/styles/settings-controls.css:195:.settings-segmented > .settings-segmented__btn:has(> input:is(:disabled, [aria-disabled="true"])) {
ui/src/styles/settings-native-controls.css:77:.settings-row--toggle:has(.settings-toggle__input:is(:disabled, [aria-disabled="true"])) {
$ rg -n -U "(settings-toggle|settings-segmented)[\s\S]{0,200}?(\.disabled|:disabled|\[disabled\])" ui/src/e2e ui/src/test-helpers
(exit 1)
```

Production code reading native `disabled` on these controls (full output in `tests/consumer-greps.txt`):

```
$ rg -n "(settings-toggle__input|settings-segmented__(input|btn)|role=.switch)" ui/src --glob "!*.test.*" --glob "!**/e2e/**" --glob "!**/test-helpers/**" --glob "!*.css"
```

Every hit outside `settings-ui.tsx` is another component's own markup (sidebar session menu, new-session controls, chat context window and its option buttons, the usage time-series button that reuses the `settings-segmented__btn` class, the chat pane focusable-role selector) or a test-support helper reading `checked` / `value` (`cron/view.test-support.ts`, `config/memory-page.test-support.tsx`, `config/updates.test-support.ts`); none reads `disabled`. Inside the component, the remaining `:disabled` checks serve `<fieldset disabled>` and per-option `disabled`.

Three of the updated consumer assertions use `matches(':disabled, [aria-disabled="true"]')` instead of `aria-disabled` alone, because the collection they check mixes shared controls with native inputs or buttons (Dreaming settings "every input", the Appearance background upload state "every button", and the existing fieldset-busy radio test, which now also checks native `:disabled` separately as described above); every assertion on a single shared control checks `aria-disabled`.
