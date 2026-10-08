# Spoken lines

Each spoken line is one MP3 at `audio/<voice>/<lineKey>.mp3`. The app fetches a clip the first time it is needed
(and the service worker caches it for offline use). Only the short sound effects are embedded in `index.html`.

- `momster/` is the default voice every kid hears.
- Character voices (`squeaky`, `fairy`, `dino`, `bear`, `robo`, `ghost`) are optional. If a kid picks one and a clip exists there, it plays; otherwise the app falls back to `momster/`.
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
