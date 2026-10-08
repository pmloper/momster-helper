// Lists lines in audio/lines.csv that have no clip yet in the default voice folder (audio/momster/).
//   node tools/missing-clips.mjs            -> summary by category
//   node tools/missing-clips.mjs --list     -> every missing key with its text
// Rebuild the manifest first:  node tools/build-audio-manifest.mjs
import fs from 'node:fs';
import path from 'node:path';

const parse = text => { // minimal CSV parser (quoted fields, doubled quotes)
  const rows = []; let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) { const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
    else if (c === '"') q = true; else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; } else if (c !== '\r') cur += c; }
  return rows;
};
const [head, ...rows] = parse(fs.readFileSync(path.join(process.cwd(), 'audio/lines.csv'), 'utf8'));
const ix = Object.fromEntries(head.map((h, i) => [h, i]));
const manifest = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'audio/manifest.json'), 'utf8'));
const have = new Set(manifest.momster || []);
const missing = rows.filter(r => r[ix.key] && !have.has(r[ix.key]) && r[ix.played_in_app].startsWith('yes'));
const byCat = {};
for (const r of missing) byCat[r[ix.category]] = (byCat[r[ix.category]] || 0) + 1;
console.log(`${missing.length} lines played by the app have no clip in audio/momster/`);
for (const [c, n] of Object.entries(byCat).sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)}  ${c}`);
if (process.argv.includes('--list')) for (const r of missing) console.log(`${r[ix.key]}\t${r[ix.text]}`);
