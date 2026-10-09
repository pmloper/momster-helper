// Lists the clips that still have to be generated, per voice folder, from audio/lines.csv and audio/manifest.json.
//   node tools/missing-clips.mjs                 -> how many clips each voice still needs, by category
//   node tools/missing-clips.mjs --list          -> every missing clip with its text
//   node tools/missing-clips.mjs --voice villains/m_sock --list
//   node tools/missing-clips.mjs --all           -> also count labels and text that is shown but not played yet
// Voices: momster, and villains/<villain id> (each villain's own voice).
// A line with speaker "momster" is needed in audio/momster/; a villain's own line only in that villain's folder;
// a "villains:any" line in every villain's folder. Rebuild the manifest first:  node tools/build-audio-manifest.mjs
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
const VILLAINS = ['m_sock', 'm_crumb', 'm_dust', 'm_toy', 'm_slime', 'm_troll', 'm_booger', 'm_stink'];
const MOMSTER = ['momster'];
const only = process.argv.includes('--voice') ? process.argv[process.argv.indexOf('--voice') + 1] : null;
const all = process.argv.includes('--all');

const need = {};   // voice folder -> [{key, text, category}]
for (const r of rows) {
  if (!r[ix.key]) continue;
  if (!all && !(r[ix.played_in_app] || '').startsWith('yes')) continue;
  const sp = r[ix.speaker] || 'momster';
  const voices = sp === 'momster' ? MOMSTER : sp === 'villains:any' ? VILLAINS.map(v => 'villains/' + v) : ['villains/' + sp];
  for (const v of voices) (need[v] = need[v] || []).push({ key: r[ix.key], text: r[ix.text], category: r[ix.category] });
}
let grand = 0;
for (const v of [...MOMSTER, ...VILLAINS.map(x => 'villains/' + x)]) {
  if (only && only !== v) continue;
  const have = new Set(manifest[v] || []);
  const todo = (need[v] || []).filter(l => !have.has(l.key));
  grand += todo.length;
  console.log(`${v.padEnd(18)} needs ${String((need[v] || []).length).padStart(4)} clips, has ${String((need[v] || []).length - todo.length).padStart(4)}, missing ${String(todo.length).padStart(4)}`);
  if (only || process.argv.includes('--list')) {
    if (!process.argv.includes('--list')) { const byCat = {}; for (const l of todo) byCat[l.category] = (byCat[l.category] || 0) + 1; for (const [c, n] of Object.entries(byCat).sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)}  ${c}`); }
    else for (const l of todo) console.log(`  ${l.key}\t${l.text}`);
  }
}
console.log(`total missing: ${grand}`);
