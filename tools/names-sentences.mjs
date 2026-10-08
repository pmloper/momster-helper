// Turns a list of first names into the exact sentences and file paths to generate.
//   node tools/names-sentences.mjs names.txt > audio/names-to-generate.csv
// names.txt: one name per line (any case; accents are fine). The output has one row per name and sentence template:
//   path,sentence   (save each generated clip at "path", relative to the repo root)
import fs from 'node:fs';

const slug = n => n.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const STYLES = { hero: 'Super', princess: 'Princess', knight: 'Knight', ninja: 'Ninja' };
// Keep in sync with nameLineText() in index.html.
const TEMPLATES = {
  hi: n => `Hi ${n}!`,
  justme: n => `Back to just ${n}!`,
  ...Object.fromEntries(Object.entries(STYLES).map(([id, title]) => [`ready_${id}`, n => `${title} ${n}, ready to help Momster!`])),
};

const file = process.argv[2];
if (!file) { console.error('usage: node tools/names-sentences.mjs names.txt'); process.exit(1); }
const names = [...new Set(fs.readFileSync(file, 'utf8').split(/\r?\n/).map(s => s.trim()).filter(Boolean))];
const q = s => /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
console.log('path,sentence');
for (const n of names) for (const [t, f] of Object.entries(TEMPLATES)) console.log(`${q(`audio/names/${t}/${slug(n)}.mp3`)},${q(f(n))}`);
