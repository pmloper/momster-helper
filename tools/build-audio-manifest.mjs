// Rebuilds audio/manifest.json from the mp3 files in audio/<voice>/<lineKey>.mp3.
// Run after adding or removing clips:  node tools/build-audio-manifest.mjs
import fs from 'node:fs';
import path from 'node:path';

const root = path.join(process.cwd(), 'audio');
const manifest = {};
for (const voice of fs.readdirSync(root, { withFileTypes: true })) {
  if (!voice.isDirectory()) continue;
  const keys = fs.readdirSync(path.join(root, voice.name))
    .filter(f => f.toLowerCase().endsWith('.mp3'))
    .map(f => f.slice(0, -4))
    .sort();
  if (keys.length) manifest[voice.name] = keys;
}
fs.writeFileSync(path.join(root, 'manifest.json'), JSON.stringify(manifest, null, 1) + '\n');
console.log(Object.entries(manifest).map(([v, k]) => `${v}: ${k.length} clips`).join('\n') || 'no clips found');
