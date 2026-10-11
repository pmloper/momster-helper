# Convex backend (draft)

`schema.ts` is a first draft of the data model for moving Momster Helper from per-device localStorage to Convex
with Convex Auth (email code). It is not wired into the app and has not been validated with the Convex CLI yet.

## localStorage -> table

| localStorage key | Convex table |
|---|---|
| `starjobs_family` (kids, jobs, helper, prizes, picks) | `kids` + `families` |
| `starjobs_settings` (without `pin`) | `settings` |
| `starjobs_settings.pin` | `pins` (salted hash, verified in a function) |
| `starjobs_w_<WEEK>_<kidId>` | `weeks` |
| `starjobs_buddy_<kidId>` | `buddies` |
| `teams/<WEEK>` (in-memory today) | `teamWeeks` |
| `starjobs_streaks`, `starjobs_mystery`, `starjobs_toots`, `starjobs_rankSeen`, `starjobs_intro_<WEEK>`, `starjobs_report_<WEEK>`, `starjobs_mon_<WEEK>`, `starjobs_jod_<day>`, `starjobs_evsaid_*`, `starjobs_mpop_*` | `familyFlags` (shared per family) |
| `starjobs_vol`, `starjobs_voiceLvl`, `starjobs_readMode`, `starjobs_installedHint`, `starjobs_wizOffered` | stay in localStorage (per device) |
| `starjobs_v_<key>`, `momster_voice` (recorded clips) | dropped; replaced by `voiceClips` + files in `audio/` |

## Open decisions
- Offline writes: the Convex client does not queue offline mutations, so the app keeps a localStorage cache and a write queue.
- Week boundary: the server uses `families.timezone`; the client's 60-second rollover timer goes away.
- Merge behaviour: whole-document overwrites become small mutations (for example `completeJob`, `undoJob`, `spendCoins`).
- First-launch import of an existing family's localStorage data into these tables.

## Sign-in (email code)

Files: `auth.ts` (providers + first-sign-in family linking), `authEmail.ts` (code generation and sender),
`auth.config.ts`, `http.ts`, `families.ts` (`myFamily`, `addAllowedEmail`, `removeAllowedEmail`, `linkUser`).

- 6-digit code, valid 10 minutes, at most 5 failed attempts per hour. The typed email is matched case-insensitively.
- First verified sign-in: if the email is in `allowedEmails` the user joins that family as a member, otherwise a new family
  is created with the user as owner. Only the owner can add or remove allowed emails.
- The email is sent by a webhook so GoHighLevel can send it. Set these in the Convex dashboard (never commit them):
  - `AUTH_EMAIL_WEBHOOK_URL` : the GHL inbound webhook URL. If unset, the code is only logged (dev).
  - `AUTH_EMAIL_WEBHOOK_SECRET` : optional; sent as the `x-webhook-secret` header.
- Webhook body: `{ "email": "...", "code": "123456", "expiresInMinutes": 10, "app": "Momster Helper" }`.
  The GHL workflow should send "Your Momster Helper code is {{code}}. It works for {{expiresInMinutes}} minutes."
- Also set `CONVEX_SITE_URL` (Convex sets it) and run `npx @convex-dev/auth` once to generate the JWT keys.

## Checks
- `npm run test:convex` : unit tests for the code sender (no deployment needed).
- `npm run typecheck` : needs `convex/_generated/`, which `npx convex dev` creates (it is gitignored).

Not done yet: nothing in `index.html` calls any of this, and none of it has run against a real Convex deployment.

## Sync (first release)

The app syncs through a generic per-family document store (`docs.ts`, table `docs`) using the same paths its old sync code
used: `family/main`, `settings/main`, `weeks/<weekStart>_<kidId>`, `buddies/<kidId>`, `teams/<weekStart>`, `voices/<key>`.
`cloud-db.js` wraps these functions in a Firestore-style `db.doc(path).set/get/onSnapshot` shim, so `writeDoc` and
`subscribe()` in `index.html` work unchanged. The typed tables in `schema.ts` (weeks, buddies, ...) are the later, stricter model.

- Signed out, the app works exactly as before on this device only. Signing in is optional (Grown-ups, then "Sync across devices").
- First sign-in on a device that already has a set-up family and an empty cloud copy uploads that family. If the cloud
  copy already exists, the device takes it (a backup of the old local data is kept in `momster_backup_before_sync`).
- Offline safety: every save is remembered as "dirty" (`momster_dirty`) until the cloud accepts it. On reconnect or app
  start, dirty documents are uploaded before any cloud copy is applied, so newer work on a device is never replaced.
  A network failure keeps the login; only an "invalid refresh token" answer signs the user out.
- PIN: stored as `pinHash` + `pinSalt` (salted SHA-256), never plain text; an older plain PIN is upgraded on first sync.
- Abuse limits: 5 sign-in codes per address per hour and 300 overall per hour (`throttle.ts`).
- Delete my online data: owner-only `account.deleteFamily` removes the family's documents, members and sign-ins.
- Known limits: last write wins per document (two devices editing the same kid's week while both offline: the later upload wins);
  recorded voice clips are synced but are legacy.

## Name voices (`voice.ts`, `voiceLogic.ts`)

A kid name that is not in the shipped list (`audio/common-names.txt`) is generated in Momster's voice when a signed-in family saves it,
and a parent can give a "say it like" spelling. The app asks with `voice.requestName`, listens with `voice.myNameClips`, and drops unused
clips with `voice.removeName`. Clips are stored in Convex file storage (`voiceClips`, key `nm_<slug>`); every attempt is a row in `voiceUsage`.

- Set in the Convex dashboard (never commit): `ELEVENLABS_API_KEY` (a restricted key: text-to-speech only, with a monthly credit cap).
  Optional: `ELEVENLABS_VOICE_ID` (default is the shipped Momster voice), `ELEVENLABS_MODEL_ID` (default `eleven_v4`), `VOICE_DISABLED=1` (kill switch).
- Limits (`voiceLogic.ts`): 24 custom names per family, 15 generations per family per day, 3,000 per day for everyone. The limit is checked and
  the attempt recorded before any money is spent. Names are letters only, up to 24 characters.
- Check a deployment's setup: `npx convex run voice:selfTest` (says one word, reports the key and status; no personal data).
- Deleting a family also deletes its clips and usage rows.
