# Guard chunk fails while unsent work blocks the reload, through a real Gateway

Head `d09fe6c8ec8` (base `b11b610d173`), built with
`OPENCLAW_BUILD_PRIVATE_QA=1 OPENCLAW_RUN_NODE_SKIP_DTS_BUILD=1 pnpm build`. Isolated real Gateway
(`dist/index.js`) serving the built Control UI, Playwright Chromium headless shell, paired browser,
service workers blocked. Same harness as `real-gateway-media-ip-host.md`. Script:
`chat-media-ip-host-blocked-reload.real-gateway.e2e.test.ts` in this folder (not part of the PR),
copied to `ui/src/e2e/` and run with

```sh
node scripts/run-vitest.mjs run --config test/vitest/vitest.ui-e2e.config.ts --configLoader runner \
  ui/src/e2e/chat-media-ip-host-blocked-reload.real-gateway.e2e.test.ts
```

It passed 3 of 3 runs. The files here come from the last run.

Setup: an ordinary session seeded through `appendTranscriptMessages` with a user prompt, one
captionless assistant message `MEDIA:https://8.8.8.8/a.png`, eight captionless assistant messages
with blocked hosts (`127.0.0.1`, `169.254.169.254`, `[::1]`, `0x7f.1`, `192.168.1.10`, `100.64.0.1`,
`[::ffff:127.0.0.1]`, `localhost`) and a closing text message. A second session is created with
`sessions.create { incognito: true }`. A Playwright route answers every https request with a 1x1
PNG, so nothing leaves the host.

Steps:

1. Open the Incognito session and attach `private-note.txt` to its composer without sending it.
   That is an unsent private attachment draft, so the draft owner's reload guard blocks reloads
   (`ui/src/pages/chat/chat-state-controller.ts:266`). The guard chunk has not been requested yet.
2. From then on, route-abort `assets/link-reader-response-*.js` (`net::ERR_FAILED`).
3. Click the ordinary session in the sidebar. This is in-app navigation, so no document loads.
   The transcript renders, the normalizer requests the guard chunk and the import fails.
4. Check the result. The draft's notice "An unsent Incognito draft is keeping this tab open.
   Review it before refreshing." appears once, with the action "Review private draft". There is
   no public IP image and the page does not reload. Screenshot: `real-gateway-blocked-reload-notice.png`.
5. Allow the chunk again. Click "Review private draft". The "Unsent Incognito draft" dialog lists
   `private-note.txt` and offers Download, "Keep in this tab" and "Discard this draft and refresh".
   Screenshot: `real-gateway-blocked-reload-review.png`.
6. Click "Discard this draft and refresh". The page probes `index.html` and reloads. The guard chunk
   loads, `https://8.8.8.8/a.png` is requested, and the image renders and decodes (naturalWidth 1).
   Screenshot: `real-gateway-blocked-reload-recovered.png`. It is the same 1x1 grey fixture card as
   in `real-gateway-guard-loaded.png`.

The notice comes from the normalizer's report. The automatic stale-chunk path only checks
`canReloadControlUiDocument()` without reporting (`ui/src/app/stale-chunk-reload.ts:165`). The only
caller in this flow that asks the blocking owner to show its notice is the guard loader's
`canReloadControlUiDocument(true)` (`ui/src/lib/chat/message-normalizer.ts:435`).

Timeline (ms after the first navigation, `real-gateway-blocked-reload.json`):

| ms | event |
| ---: | --- |
| 528 | private attachment draft staged in the Incognito session |
| 755 | `GET <gateway>/assets/link-reader-response-*.js`, aborted (`net::ERR_FAILED`) |
| 806 | IP literal transcript shown |
| 818 | reload-blocked notice visible with "Review private draft" |
| 1,834 | public IP images while the guard is unavailable: 0, no reload |
| 2,394 | guard chunk allowed again |
| 2,528 | "Review private draft" clicked; dialog lists `private-note.txt` at 2,560 |
| 3,160 | "Discard this draft and refresh" clicked; `HEAD <gateway>/index.html` probe |
| 3,224 | document reload (`GET <gateway>/chat/main/media-ip-host-blocked-reload?openclaw_mount_recovery=...`) |
| 3,404 | `GET <gateway>/assets/link-reader-response-*.js` (loads) |
| 3,478 | `GET https://8.8.8.8/a.png` |
| 3,502 | public IP image rendered and decoded |

Network: 117 requests. 116 go to the Gateway origin (shown as `<gateway>`). The only https request
is `https://8.8.8.8/a.png`, made after the reload. None of the eight blocked media URLs is requested,
and none of their hosts appears in the transcript text. The log has no credentials or tokens. The
pairing state comes from the browser storage state and is not in any URL. Playwright reports the
`index.html` probe and two avatar fetches as `net::ERR_ABORTED`. The avatar fetches show the same
error in the earlier run. The reload in `retryStaleChunkReloadWhenReachable` only starts after the
probe returns ok, so the probe got its answer.

After the reload, the Incognito session no longer appears in the sidebar. The draft was discarded
in step 6, and this proof does not check Incognito session lifetime.
