# Momster Helper: handoff notes

Read this first in a new session. It says where things stand, what was decided, and how to work on it. No keys or passwords are in the repo; see "Settings a new session needs".

## Where the work is

- Repo `pmloper/momster-helper`. All current work is on the branch **`claude/store-coins-rework`** (it already contains the older bug-fix branch). Nothing is merged to `main` on purpose: the owner wants the voices finished and tested first, then one push to main.
- The app is one file, `index.html` (vanilla JS, template-literal rendering, global `render()`), plus `tour.js` (Momster's tutorial), `cloud*.js` (sign-in and sync), `sw.js` (offline cache) and a Convex backend in `convex/`.
- Preview: the owner uploads a zip to Cloudflare Pages by hand (Direct Upload; the repo is not connected, so a push does not change the live preview). Build it with:
  `zip -qr preview.zip index.html tour.js sw.js manifest.json cloud*.js vendor icons favicon* art audio -x '*.md' 'audio/lines.csv' 'audio/_candidates/*' 'audio/voices.json' 'audio/speak-overrides.json' 'audio/common-names.txt'`
  The upload limit for sending files from a session is about 30 MB; the zip is about 17 MB.
- Open `/?dev=1` on the preview for a development bar (pick any of the 8 villains and their health). `?dev=0` turns it off. It saves nothing.

## Decisions already made (do not re-ask)

- **One voice for Momster** (ElevenLabs, model `eleven_v4`, stability 32%, voice id in `audio/voices.json`). A "record your own voice" option is shown as "Coming soon" (planned: cloned family voice through Convex, behind a paywall later).
- **Each of the 8 villains has a fixed voice** (ids in `audio/voices.json`). Shared villain lines are recorded in all 8 voices. Villains never say a kid's name. No sound-effect words or stage directions are sent to the voice service; plain text only.
- **Kid names are stitched** from three clips: a lead-in, the name alone, and (for hero-style lines) a tail, played gap-free through Web Audio. About 250 common names ship (`audio/common-names.txt`). Other names are generated on demand through Convex (`convex/voice.ts`) when a signed-in family saves them, with a "Say it like" box for pronunciation. See `audio/README.md`, "Kid names".
- "Sidekick" is now **"hero helper"** everywhere, including the spoken lines and the tutorial.
- A costume (hero style) is drawn over the hero helper and never unlocks or replaces items. Two hands: left then right; a third item asks which to put away.
- Every celebration card waits for a tap; a tap anywhere else closes it. After each finished job group: a coin card, then a joke card (one fixed joke per kid, group and day; "Joke time!" is said once).
- Speech that arrives on its own (cards, announcements) waits for a line already being said. The surprise-mission announcement waits until the weekly prize is picked.
- Audio is mono MP3 at 48 kbps. Sound effects at the start of a spoken line play under the voice.

## How to work on it

- Tests are plain Node scripts in `tests/` (browser tests drive real Chromium over CDP; no packages). In a cloud session the hook sets `CHROME`; elsewhere set it to a Chrome path. Examples: `node tests/cards.test.js`, `npm run test:audio`, `npm run test:convex`, `npm run typecheck`, `node local_checks_v59.mjs`.
  Known: `prize-confirm` and `prize-confirm-trap` fail on `main` too (not regressions).
- **Every spoken line must be in `audio/lines.csv`** and have a clip: `node tests/audio-coverage.test.js` and `node tools/missing-clips.mjs` prove it. The clip key for written text is `textKey(text)` (same function in `index.html` and the tools).
- Audio workflow (details in `audio/README.md`): add rows to `lines.csv` -> `node tools/generate-clips.mjs --voice <momster|villains/m_x|all> [--category ...] [--key ...] --takes 1 --max-chars N` -> `node tools/check-clips.mjs --transcribe` (levels the clip and checks it by transcription) -> pick takes -> `node tools/promote-clips.mjs decisions.json` -> `node tools/missing-clips.mjs`. Candidates live in `audio/_candidates/` (not committed).
- Network: cloud sessions reach ElevenLabs and Convex only if the environment's network access allows `api.elevenlabs.io` and `*.convex.cloud`. Node needs `NODE_USE_ENV_PROXY=1` behind the proxy (the tools restart themselves with it). The `npx convex` live connection does not go through the proxy: `convex dev --once` and `convex run` work, `convex env list` hangs.

## Settings a new session needs (set in the cloud environment, never in the repo)

- `ELEVEN_LABS_API` (or `ELEVENLABS_API_KEY`): ElevenLabs key as a **plain environment variable**. Do not also add it under network secrets: the proxy then adds a second login header and ElevenLabs refuses both.
- `CONVEX_DEPLOY_KEY`: a **dev** deployment key (deployment `honorable-kiwi-400`) if the session should push Convex code.
- In the Convex dashboard (not the repo): `ELEVENLABS_API_KEY` (restricted key, text-to-speech only, with a credit cap), `AUTH_EMAIL_WEBHOOK_URL` (+ optional secret) for sign-in emails. Check with `npx convex run voice:selfTest`.

## Still to do

- Production Convex deployment is not done (only the dev deployment exists).
- Bump the service-worker cache name in `sw.js` at release.
- "Record your own voice" (family clone) is not built. Custom prize / job text generation on entry is not built.
- Tap-to-hear for the hero-helper builder tabs (Ears, Eyes, ...), which are buttons.
- Test on real phones and tablets (everything so far was checked in desktop Chrome and by tests).
- Finally: merge to `main` once the owner says the audio is done.
