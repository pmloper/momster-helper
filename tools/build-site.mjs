// Builds the folder that gets published: dist/ holds only what the app needs to run (no tests, tools, Convex code or line lists).
//   node tools/build-site.mjs            (or: npm run build:site)
// Cloudflare Pages: build command "npm run build:site", output directory "dist".
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd(), out = path.join(root, 'dist');
const files = ['index.html', 'tour.js', 'sw.js', 'manifest.json', 'cloud.js', 'cloud-core.js', 'cloud-db.js', 'favicon-64.png'];
const dirs = ['vendor', 'icons', 'art', 'audio'];
// Inside audio/ only the clips and the list the app reads are published (not the line list, voice settings or notes).
const skipAudio = new Set(['lines.csv', 'voices.json', 'speak-overrides.json', 'common-names.txt', 'README.md', '_candidates']);

fs.rmSync(out, { recursive: true, force: true }); fs.mkdirSync(out, { recursive: true });
for (const f of files) { if (!fs.existsSync(path.join(root, f))) { console.error('missing ' + f); process.exit(1); } fs.copyFileSync(path.join(root, f), path.join(out, f)); }
const copy = (from, to, top) => { fs.mkdirSync(to, { recursive: true });
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    if (top && skipAudio.has(e.name)) continue; if (e.name.endsWith('.md') || e.name === '.DS_Store') continue;
    const a = path.join(from, e.name), b = path.join(to, e.name);
    if (e.isDirectory()) copy(a, b, false); else fs.copyFileSync(a, b); } };
for (const d of dirs) copy(path.join(root, d), path.join(out, d), d === 'audio');
// Caching: the page and its scripts are always re-checked (so a release shows up); clips can be kept for an hour.
fs.writeFileSync(path.join(out, '_headers'), `/index.html\n  Cache-Control: no-cache\n/sw.js\n  Cache-Control: no-cache\n/manifest.json\n  Cache-Control: no-cache\n/*.js\n  Cache-Control: no-cache\n/audio/*\n  Cache-Control: public, max-age=3600\n/art/*\n  Cache-Control: public, max-age=86400\n`);
let n = 0, bytes = 0; const walk = d => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else { n++; bytes += fs.statSync(p).size; } } }; walk(out);
console.log(`dist/ ready: ${n} files, ${(bytes / 1048576).toFixed(1)} MB`);
