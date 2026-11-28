# Upgrade from 2026.11.10

One Gateway in a disposable Docker pod with a local OpenClaw ID stand-in (OIDC issuer with device
authorization) and a trusted-proxy front end. Profile ids are replaced with names.

1. Official image `ghcr.io/openclaw/openclaw:2026.11.10` (revision 6ea542fd97e2) on fresh state.
   Profiles were created by the Gateway on each person's first sign-in; roles set by the owner with
   `users.setRole`; OpenClaw ID links made by that release's own device sign-in (`link: true`):
   `seed-links-2026.11.10.json`.
   - profile-a: person@example.test, linked to ocid-person
   - member-profile: role member, linked to ocid-member
   - maintainer-profile: role maintainer, linked to ocid-maintainer
   - profile-b: other@example.test, not linked
2. Snapshot: `snapshot-before-2026.11.10.txt`.
3. Gateway stopped; the PR build (249a8ec71459, repo Dockerfile) started on the same state volume.
   Startup migrated the state from schema 40 to 42: `schema.txt`.
4. Snapshot: `snapshot-after-upgrade.txt`. Every column of the three tables is identical:
   `snapshot-diff.txt`.
5. On the upgraded Gateway, each device code approved at the issuer (every ID token has
   `email_verified: true`):

| Leg | Connection login | Approving account | `link` | Rows |
| --- | --- | --- | --- | --- |
| 1 | person@example.test (profile-a) | ocid-person, person@example.test | `linked` | no change (existing link recognized) |
| 2 | other@example.test (profile-b) | ocid-second, person@example.test | `link_approval_required` | no change |
| 3 | other@example.test (profile-b) | ocid-other, other@example.test | `linked` | one row: ocid-other on profile-b |

Per leg: `legN-*.json` (poll result and link_status), `legN-*.snapshot.txt` and `legN-*.diff.txt`
(against the snapshot before that leg). Email aliases and roles did not change in any leg.
