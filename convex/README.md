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
