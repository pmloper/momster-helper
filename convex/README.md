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
