# Spoken lines

Each spoken line is one MP3 at `audio/<voice>/<lineKey>.mp3`. The app fetches a clip the first time it is needed
(and the service worker caches it for offline use). Only the short sound effects are embedded in `index.html`.

- `momster/` is the default voice every kid hears.
- Character voices (`squeaky`, `fairy`, `dino`, `bear`, `robo`, `ghost`) are optional. If a kid picks one and a clip exists there, it plays; otherwise the app falls back to `momster/`.
- If no clip exists for a line, the app reads the text with the device voice, so nothing is silent while clips are being added.
- `<lineKey>` must match the key in `audio/lines.csv` exactly.

After adding or removing files, run `node tools/build-audio-manifest.mjs` to refresh `audio/manifest.json`
(the app only plays files listed there).

## Kid names

Sentences that include a kid's name are one generated clip per name and template, at
`audio/names/<template>/<name-slug>.mp3` (slug = lowercase, accents removed, other characters become `-`).
Templates: `hi`, `justme`, `ready_hero`, `ready_princess`, `ready_knight`, `ready_ninja`.

1. Put one first name per line in a text file.
2. `node tools/names-sentences.mjs names.txt > audio/names-to-generate.csv` gives the exact sentence and file path for each clip.
3. Generate the clips, then `node tools/build-audio-manifest.mjs`.

A name with no clip is read by the device voice (whole sentence).
