// Adds kid-name rows to audio/lines.csv so the normal generate / check / review / promote workflow makes a clip for each name.
//   node tools/add-names.mjs audio/common-names.txt        (one first name per line; names already in the list are skipped)
// Each name becomes the row  nm_<slug>,momster,kid name,<Name>  and is spoken on its own; the app stitches it between a lead-in and a tail
// (audio/README.md, "Kid names"). A name that comes out wrong is fixed with a respelling in audio/speak-overrides.json under its key.
import fs from 'node:fs';

export const slug = n => String(n || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const q = s => /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;

export function addNames(csvPath, names) {
  const text = fs.readFileSync(csvPath, 'utf8');
  const have = new Set(text.split('\n').map(l => l.split(',')[0]));
  const rows = []; const seen = new Set();
  for (const raw of names) {
    const n = raw.trim(), key = 'nm_' + slug(n);
    if (!n || key === 'nm_' || have.has(key) || seen.has(key)) continue;
    seen.add(key);
    rows.push([key, 'momster', 'kid name', n, 'NEW', 'yes (kid name)', 'spoken alone; stitched between a lead-in and a tail', '', 'momster'].map(q).join(','));
  }
  if (rows.length) fs.appendFileSync(csvPath, (text.endsWith('\n') ? '' : '\n') + rows.join('\n') + '\n');
  return rows.length;
}

if (process.argv[1] && process.argv[1].endsWith('add-names.mjs')) {
  const file = process.argv[2];
  if (!file) { console.error('usage: node tools/add-names.mjs names.txt'); process.exit(2); }
  const n = addNames('audio/lines.csv', fs.readFileSync(file, 'utf8').split(/\r?\n/));
  console.log(n + ' names added to audio/lines.csv');
}
