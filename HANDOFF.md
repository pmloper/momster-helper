# Momster Helper: handoff notes

Read this first, whether you are a new session, a new developer, or the person who will deploy it. It covers: how the repository is laid out, who worked on it and when, what has been decided, the rules to follow, and how to deploy. No keys or passwords are in the repo (see "Settings that are not in the repo").

## 1. What this is

A chore-chart PWA for kids ("Momster Helper"): kids finish jobs to earn stars and coins, the family beats a silly mess villain each week, and a hero helper (a customizable monster) can be dressed up with coins. It runs entirely in the browser; an optional sign-in (email code) syncs a family's data through Convex. Momster and the 8 villains speak with generated voice clips.

## 2. Repository layout

| Path | What it is |
|---|---|
| `index.html` | The whole app in one file: styles, markup templates and all the JavaScript (global `render()`, click handling in one `data-a` switch). Almost every feature change is here. |
| `tour.js` | Momster's narrated tutorial. Caption times (`STEPS`) must match the recordings; `node tools/tour-times.mjs 7 8 9 10` measures them. |
| `cloud.js`, `cloud-core.js`, `cloud-db.js` | Optional sign-in and sync with Convex (`cloud.js` holds the public Convex address). `vendor/convex.js` is the bundled Convex client (rebuild with `npm run build:vendor`). |
| `sw.js` | Service worker (offline cache). **Its cache name must be bumped on every release** (currently `momster-helper-v82-store-coins`). |
| `manifest.json`, `icons/`, `favicon-64.png`, `art/` | Install info, icons, and Momster's pose pictures (`art/momster/*.webp`). |
| `audio/` | Everything spoken. Clips are `audio/momster/<key>.mp3` and `audio/villains/<villain id>/<key>.mp3` (mono MP3, 48 kbps), listed in `audio/manifest.json`. `lines.csv` is the master list of every spoken line; `voices.json` holds the voice ids and settings; `speak-overrides.json` holds respellings; `common-names.txt` is the shipped name list. `audio/README.md` explains the workflow. `audio/_candidates/` is scratch (git-ignored). |
| `convex/` | The Convex backend: sign-in (`auth*.ts`, `families.ts`), family data sync (`docs.ts`), account deletion (`account.ts`), sign-in throttling, and name voices (`voice.ts`, `voiceLogic.ts`). `convex/README.md` describes it. `convex/_generated/` is git-ignored. |
| `tools/` | Audio and build tools (`generate-clips`, `check-clips`, `promote-clips`, `build-audio-manifest`, `missing-clips`, `add-names`, `tour-times`) and **`build-site.mjs`**, which builds the folder that gets published. |
| `tests/` | Plain Node test scripts (browser tests drive real Chromium; no extra packages). |
| `local_checks_v59.mjs` | Syntax and static checks, run first by `npm test`. |
| `.claude/` | Session-start hook for cloud Claude sessions (installs what tests need). |
| `.nojekyll` | Left over from when the app was published on GitHub Pages. Harmless. |
| `HANDOFF.md` | This file. |

## 3. Who worked on it, and when

Read from the git history (names are the commit authors as recorded; the history has 165 commits across all branches):

| When | Author as recorded | What |
|---|---|---|
| 2026-10-05 | `atlas` / `Atlas` (a Flytown Studios address) | Versions v37 to v54 on `main`, published through GitHub Pages (many "cache-bust" commits): health pool and damage scaling, mystery hit, more-than-2-kids layout, prize and mission flows, first-run wizard, "Momster host", first voice packs. |
| 2026-10-06 to 10-07 | `Skeeter (Hermes dev)` / `skeeter` / `Skeeter` | Versions v57 to v66 as preview branches (`skeeter/...`): wizard fixes, combined sound menu, phone scrolling, mission pop-ups, joke of the day, the Momster SVG portrait, kid header with prize pill and mission siren, per-kid leave-by times and Morning Race toggle. |
| 2026-10-06 to 10-07 | `pmloper` (the repo owner) | Reviewed and merged those branches into `main` through pull requests #1 to #14, and made the first mobile-prize hotfixes. `main` was last updated on 2026-10-07 (PR #14). |
| 2026-10-08 to 10-10 | `Claude` (cloud sessions working with the owner) | Convex sign-in and sync, the store and coin rework, hero styles as costumes, Momster's tutorial, all voices (about 1,440 clips), name stitching and on-demand names, tap-to-continue cards, jokes, toot milestones, the development view, and the renamed "hero helper". 82 commits on `claude/store-coins-rework`, **none merged to `main` yet**. |

Branches on GitHub:
- `main`: the last released state (2026-10-07, PR #14). Behind the working branch by 82 commits.
- **`claude/store-coins-rework`**: current work. It already contains `claude/dazzling-turing-1y5mce` (an earlier bug-fix branch).
- `preview` and `skeeter/*`: older preview branches from the work above. Safe to delete once nobody needs them.

## 4. Decisions already made (do not re-ask)

- **One voice for Momster** (ElevenLabs, model `eleven_v4`, stability 32%, voice id in `audio/voices.json`). "Record your own voice" is shown as "Coming soon" (planned: a cloned family voice through Convex, behind a paywall later).
- **Each of the 8 villains has a fixed voice** (ids in `audio/voices.json`). Shared villain lines are recorded in all 8 voices. Villains never say a kid's name. Plain text only goes to the voice service: no sound-effect words or stage directions.
- **Kid names are stitched** from a lead-in, the name alone and (for hero-style lines) a tail, played gap-free through Web Audio. About 250 common names ship; other names are generated on demand through Convex when a signed-in family saves them, with a "Say it like" box for pronunciation (`audio/README.md`, "Kid names").
- "Sidekick" is now **"hero helper"** everywhere, including the spoken lines and the tutorial.
- A costume (hero style) is drawn over the hero helper and never unlocks or replaces items. Two hands (left then right); a third item asks which to put away.
- Every celebration card waits for a tap, and a tap anywhere else closes it. After each finished job group: a coin card, then a joke card (one fixed joke per kid, group and day; "Joke time!" said once).
- Speech that arrives on its own waits for a line already being said; the surprise-mission announcement waits until the weekly prize is picked.
- Audio is mono MP3 at 48 kbps; sound effects at the start of a spoken line play under the voice.
- Preview with `/?dev=1` for a bar that picks any villain and its health (saves nothing; `?dev=0` turns it off).

## 5. Rules for whoever deploys it

1. **Nothing goes to `main` without the owner's say-so.** Work happens on branches and reaches `main` through a pull request that the owner (`pmloper`) merges. `main` is what will be published, so it must always work.
2. **Before a release, run the checks** and read the result: `npm test` (all browser tests; it stops at the first failing file, so a clean run ends with the last file passing), `npm run test:audio`, `npm run test:convex`, `npm run typecheck` (needs `convex/_generated/`, which is git-ignored: run `npx convex codegen` once in a fresh clone; it needs the dev `CONVEX_DEPLOY_KEY`). `node tests/audio-coverage.test.js` and `node tools/missing-clips.mjs` must report nothing missing: every spoken line must have a clip.
3. **Bump the service-worker cache name in `sw.js` on every release.** Without it, installed copies can keep an old version. Three checks look for the exact name, so change it in `local_checks_v59.mjs`, `tests/momster-art.test.js` and `tests/per-kid-race.test.js` too.
4. **Never commit secrets** (API keys, deploy keys, the sign-in webhook address). Keys live in environment settings only (section 7). `.env.local` is git-ignored.
5. **Spoken text changes need new clips.** A line's clip is found by `textKey(text)`; if you change the words, the old clip stops matching. Edit `audio/lines.csv`, generate, check by transcription, promote (workflow in `audio/README.md`). Do not re-encode or rename clips by hand.
6. **Do not deploy Convex changes to production from a branch you have not tested.** Only a *dev* Convex deployment exists today (`honorable-kiwi-400`). A production one has to be created first (section 8).
7. **Keep the published folder minimal.** Publish `dist/` (built by `npm run build:site`), not the repo root: the root contains tests, tools, Convex code and the line list.
8. **Test on real phones and tablets before telling the owner it is done.** Most checks so far ran in desktop Chrome and in the test scripts.
9. **Commit style:** small commits with a clear message; branch names like `feature-name` or the `claude/...` / `skeeter/...` style already in use.

## 6. Deploying with Cloudflare Pages (to set up)

Today the preview is a zip uploaded by hand ("Direct Upload"). To link the repository instead:

1. Cloudflare dashboard, then Workers & Pages, then Create, then Pages, then **Connect to Git**, and pick `pmloper/momster-helper` (the GitHub account needs to allow Cloudflare to read it).
2. Production branch: **`main`**. Other branches will build as preview deployments with their own address, which is what the owner wants for testing.
3. Build settings: framework preset **None**; build command **`npm run build:site`**; build output directory **`dist`**. Add the environment variable `NODE_VERSION` = `22`.
4. `npm run build:site` copies only what the app needs into `dist/` (about 1,460 files, 18.5 MB; Pages allows 20,000 files and 25 MB per file) and writes a `_headers` file so the page and scripts are re-checked on every visit while clips are cached for an hour.
5. After the first build, open the address and check: the tutorial picture shows (`/art/momster/wave.webp`), `/audio/manifest.json` loads, a kid's greeting speaks. Open `/?dev=1` to look at each villain.
6. Until `main` is updated, `main` publishes the old version (before Convex, voices and the store rework). Publish a branch preview first, then ask the owner to merge.

## 7. Settings that are not in the repo

- `ELEVEN_LABS_API` (or `ELEVENLABS_API_KEY`): ElevenLabs key, as a **plain environment variable** in the cloud environment. Do not also add it under "network secrets": the proxy then adds a second login header and ElevenLabs refuses both. Only needed to generate clips, not to deploy.
- `CONVEX_DEPLOY_KEY`: a deployment key. A session should only ever have a **dev** key.
- In the Convex dashboard: `ELEVENLABS_API_KEY` (restricted to text-to-speech, with a credit cap) and `AUTH_EMAIL_WEBHOOK_URL` (+ optional `AUTH_EMAIL_WEBHOOK_SECRET`) for sign-in emails. `npx convex run voice:selfTest` checks the voice setup.
- Cloud sessions: the environment's network access must allow `api.elevenlabs.io` and `*.convex.cloud`. Node needs `NODE_USE_ENV_PROXY=1` behind the proxy (the tools restart themselves with it). `npx convex dev --once` and `convex run` work there; `convex env list` hangs.

## 8. Still to do

- **Create the production Convex deployment** and switch `CONVEX_URL` in `cloud.js` to it (the address is public). Set the dashboard variables above on it. Until then sign-in and sync use the dev deployment.
- Merge `claude/store-coins-rework` into `main` once the owner says the audio is done, with the cache name bumped.
- "Record your own voice" (family clone) is not built; custom prize and job text generation on entry is not built.
- Tap-to-hear for the hero-helper builder tabs (Ears, Eyes, ...), which are buttons.
- Real-device testing of everything built since 2026-10-08.

## 9. How to work on it

- **Tests:** plain Node scripts. In a cloud session the hook sets `CHROME`; elsewhere set `CHROME` to a Chrome path. Examples: `node tests/cards.test.js`, `npm run test:audio`, `npm run test:convex`, `npm run typecheck`, `node local_checks_v59.mjs`.
- **Preview zip by hand** (still handy): `zip -qr preview.zip index.html tour.js sw.js manifest.json cloud*.js vendor icons favicon* art audio -x '*.md' 'audio/lines.csv' 'audio/_candidates/*' 'audio/voices.json' 'audio/speak-overrides.json' 'audio/common-names.txt'`. Or zip the `dist/` folder.
- **Audio workflow:** add rows to `audio/lines.csv`, then `node tools/generate-clips.mjs --voice <momster|villains/m_x|all> [--category ...] [--key ...] --takes 1 --max-chars N`, then `node tools/check-clips.mjs --transcribe`, pick takes, `node tools/promote-clips.mjs decisions.json`, then `node tools/missing-clips.mjs`. Candidates live in `audio/_candidates/`.
