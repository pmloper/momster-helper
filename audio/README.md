# Spoken lines

Each spoken line is one MP3 at `audio/<voice>/<lineKey>.mp3`. The app fetches a clip the first time it is needed
(and the service worker caches it for offline use). Only the short sound effects are embedded in `index.html`.

- `momster/` is Momster's voice. (A family will later be able to swap in a voice cloned from their own recording; until a line exists in that voice it falls back to `momster/`.)
- Each villain has a fixed voice of their own in `villains/<villain id>/` (`m_sock`, `m_crumb`, `m_dust`, `m_toy`, `m_slime`, `m_troll`, `m_booger`, `m_stink`). A villain never plays a clip from another folder.
- The old character voices (`squeaky`, `fairy`, `dino`, `bear`, `robo`, `ghost`) are retired.
- If no clip exists for a line, the app plays nothing for it. `node tools/missing-clips.mjs` lists what is still missing.
- The device voice is only used to read a kid's name that has no generated clip yet (see Kid names).
- `<lineKey>` is the `key` column in `audio/lines.csv` (generate the `text` column). Keys that start with `t_` are derived from the exact sentence, so the app finds the clip for any written line, including ones a family writes themselves.

After adding or removing files, run `node tools/build-audio-manifest.mjs` to refresh `audio/manifest.json`
(the app only plays files listed there).

## Kid names

Sentences that include a kid's name are one generated clip per name and template, at
`audio/names/<template>/<name-slug>.mp3` (slug = lowercase, accents removed, other characters become `-`).
Templates: `hi`, `justme`, `blame`, `ready_hero`, `ready_princess`, `ready_knight`, `ready_ninja`.

1. Put one first name per line in a text file.
2. `node tools/names-sentences.mjs names.txt > audio/names-to-generate.csv` gives the exact sentence and file path for each clip.
3. Generate the clips, then `node tools/build-audio-manifest.mjs`.

A name with no clip is read by the device voice (whole sentence).

## Momster's tutorial

`momster/tour_1.mp3` to `tour_10.mp3` are the ten lines of the narrated tutorial (`tour.js`, texts in `lines.csv`). They always play, whatever sound option a family picked. The caption timings and highlights are the `STEPS` table at the top of `tour.js`; if you re-record a clip, re-check its pause times there. Pose pictures live in `art/momster/`.

## Who says each line

`lines.csv` has a `speaker` column: `momster`, a villain id (`m_sock`, `m_crumb`, `m_dust`, `m_toy`, `m_slime`, `m_troll`, `m_booger`, `m_stink`) for lines only that villain says, or `villains:any` for lines every villain can say. A `villains:any` line is recorded once per villain, in that villain's voice. Villain clips are meant to live in `audio/villains/<villain id>/<key>.mp3`.

## Generating the clips (ElevenLabs)

Everything below runs from the repo root. The ElevenLabs key is only ever read from the environment: `ELEVENLABS_API_KEY`, or `ELEVEN_LABS_API` / `ELEVEN_LABS_API_KEY` / `XI_API_KEY`.

1. Fill in `audio/voices.json`: a `voice_id` for `momster` (the same voice, model and settings as the tutorial lines) and for each villain. Each villain has a `description` you can paste into ElevenLabs Voice Design.
2. See the plan and the cost: `node tools/generate-clips.mjs --voice all --dry-run`. Labels (shop parts, stickers, headings) are included for tap-to-hear; add `--played-only` to leave them out. Lines that say the same words in the same voice share one clip: it is generated once and copied to each key when promoted.
3. Try a few lines first: `node tools/generate-clips.mjs --voice momster --limit 10 --max-chars 2000`
4. Generate: `node tools/generate-clips.mjs --voice all --takes 2 --max-chars 60000` (it skips takes that already exist, so it can be re-run to resume; `--max-chars` is a hard spending limit).
5. Level, trim and check them: `node tools/check-clips.mjs --transcribe` (writes `audio/_candidates/report.json` and a levelled `take<N>.norm.mp3` beside each take).
6. Listen: `node tools/build-review-page.mjs`, then open `audio/_candidates/review/index.html` (or zip the `_candidates` folder and send it). Pick a take for each line, tick "redo" or type a respelling where a line is wrong, then "Download decisions.json".
7. Ship the picks: `node tools/promote-clips.mjs decisions.json`. Picked takes go to `audio/<voice>/<key>.mp3` and the manifest is rebuilt. Redo lines are cleared; run step 4 again to regenerate just those.
8. `node tools/missing-clips.mjs` shows what is still outstanding. `node tests/audio-coverage.test.js` (via the test runner) fails if the app asks for a line that is not in `lines.csv`.

`audio/_candidates/` is ignored by git; only promoted clips are committed. Respellings go in `audio/speak-overrides.json`; the line's own text and clip name never change.
