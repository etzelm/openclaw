# Remote access and invitation, on a running Gateway

Two Gateways in disposable Docker pods, both built with the repo Dockerfile:
A = merge base 8a8e01773deb (main), B = this PR's head 249a8ec71459.
Profile ids are replaced with names. Emails are example.test. Keys, tokens, codes, invite links
and the claw id are not shown.

## What ran for real, and what was a stand-in

- Real: the Gateway under test, its Control UI in headless Chromium, the OpenClaw ID tunnel child
  with the iroh binding, and the protocol code in `packages/openclaw-id-protocol`.
- The Docker image does not include the iroh binding. It was built from the same commit's
  `crates/openclaw-iroh-node` with the crate's own build command (what `pnpm build:iroh` runs) and put
  next to `crates/openclaw-iroh-node/index.js` in the image. This is the source-checkout setup in
  docs/gateway/remote.md. No Gateway file was changed.
- Stand-ins, all local to the pod: an OIDC issuer with device authorization, a Discovery service, a
  relay that answers 503, and a trusted proxy. The Discovery stand-in verifies requests with the
  protocol package's own code (request signatures, descriptor, snapshot, peer key proof). It
  serves enrollment codes, claw names, registration, descriptor and snapshot publish, listClaws,
  bindDevice and the mailbox.
- The relay stays offline, so "Connecting claw" keeps spinning in the screenshots. Commit needs a
  running tunnel child, not a relay connection.

## People

- Admin: profile `admin-profile`, role `maintainer` (operator.admin). Connects through the trusted
  proxy as `admin@example.test`, so remote access setup runs as a personal admin.
- OpenClaw ID accounts at the issuer: `ocid-admin` (admin@example.test) and `ocid-other`
  (other@example.test). Every ID token has `email_verified: true`.

## Turn on remote access (both pods, fresh state each leg)

The admin signs in from the account menu (device code approved at the issuer), then runs
Turn on remote access: link code, claw name, recovery kit, commit. The sign-in alone changes no row.

| Leg | Account approved | A (main) | B (this PR) |
| --- | --- | --- | --- |
| a | ocid-admin, email = connection login | claw linked, profileLink `linked`, + ocid-admin -> admin-profile | same as A, no notice |
| b | ocid-other, another email | claw linked, profileLink `linked`, + ocid-other -> admin-profile | claw linked, profileLink `link_approval_required`, no identity row, setup notice shown |

Files per leg and pod: `<leg>.<A|B>.before.txt`, `.after.txt`, `.diff.txt`, `.commit-response.json`
(the commit answer read from the WebSocket), `gateway-log.<leg>.<A|B>.txt` (the Gateway's own audit
lines), `discovery-calls.<leg>.<A|B>.jsonl`. Screenshots: `leg-b-other-email.B.setup-notice.png`,
`leg-b-other-email.A.no-notice.png`, `leg-a-matching-email.{A,B}.no-notice.png`.
In every leg the claw is linked with owner account = the approving account, one owner device, and
emails and roles are unchanged.

## Invitation fallback (B, after leg b)

1. Owner browser: the same browser profile that ran setup, so it holds the owner device key. A real
   owner browser reaches the claw through the hosted claw loader and the relay. Neither is in this
   repo, so this browser connects as the local operator on the claw's computer (loopback, shared
   password) instead. The Remote access page and People are then served by the Gateway as usual.
   Invite someone: Existing person on this claw = Admin, email other@example.test, Role =
   maintainer (the admin's current role), Create invite link, confirm the administrator prompt.
   `invite-1-form.B.png`, `invite-1-created.B.png`, `invite-1-registered.B.snapshot.txt`.
2. Account side: the /join page is not in this repo. A script does what the Swift member join
   client does (apps/shared/OpenClawKit OpenClawIDMemberJoin.swift): signs in as ocid-other with the
   device grant, finds the claw id with listClaws, binds a new device key and peer key
   (POST /v1/devices), and mails the device-signed InviteRedemption with the link's proof to the
   Gateway (POST /v1/claws/{id}/mailbox). `invite-account-side.B.jsonl`. The Gateway's mailbox
   reader picked it up and recorded the request: `invite-2-redeemed.B.diff.txt`. It mailed the
   owners a `redemption_pending` notice.
3. Owner browser: "Other asked to join", Review, then Approve in People.
   `invite-2-owner-prompt.B.png`, `invite-2-people-pending.B.png` ("Will join as Admin").
4. Result, `invite-3-approved.B.diff.txt`:
   `+ openclaw.id | ocid-other | admin-profile`, member `ocid-other role=maintainer`, invite
   approved. `admin-profile | Admin | maintainer` is the same before and after.
   `invite-3-people-approved.B.png`, `invite-3-profile-linked.B.png` (Settings, Profile, through the
   trusted proxy as admin@example.test: OpenClaw ID linked, Unlink).

## Not shown

- The owner browser over the hosted claw loader and relay (it ran as the local operator instead).
- The hosted /join page itself (its protocol messages were sent by the script above).
- A leg with `email_verified: false` at commit. Device sign-in legs with unverified email are in
  the earlier running-Gateway evidence.
