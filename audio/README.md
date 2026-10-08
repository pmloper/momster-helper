# Spoken lines

Each spoken line is one MP3 at `audio/<voice>/<lineKey>.mp3`. The app fetches a clip the first time it is needed
(and the service worker caches it for offline use). Only the short sound effects are embedded in `index.html`.

- `momster/` is the default voice every kid hears.
- Character voices (`squeaky`, `fairy`, `dino`, `bear`, `robo`, `ghost`) are optional. If a kid picks one and a clip exists there, it plays; otherwise the app falls back to `momster/`.
- If no clip exists for a line, the app reads the text with the device voice, so nothing is silent while clips are being added.
- `<lineKey>` must match the key in `audio/lines.csv` exactly.

After adding or removing files, run `node tools/build-audio-manifest.mjs` to refresh `audio/manifest.json`
(the app only plays files listed there).
