// Works out the caption start times for the tutorial lines from the recordings (tour_<n>.mp3), using speech-to-text word times.
//   node tools/tour-times.mjs 7 8 9 10        (reads audio/momster/tour_<n>.mp3, or --dir <folder> for candidates)
// Prints, for each clip, its length and the start second of every caption chunk, to paste into STEPS in tour.js.
// The captions are read from tour.js (the chunk texts in STEPS), so they stay the single source of truth.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
if (!process.env.NODE_USE_ENV_PROXY && (process.env.HTTPS_PROXY || process.env.https_proxy)) {
  const r = (await import('node:child_process')).spawnSync(process.execPath, process.argv.slice(1), { stdio: 'inherit', env: { ...process.env, NODE_USE_ENV_PROXY: '1' } });
  process.exit(r.status ?? 1);
}
const key = process.env.ELEVENLABS_API_KEY || process.env.ELEVEN_LABS_API;
if (!key) { console.error('Set ELEVENLABS_API_KEY (or ELEVEN_LABS_API) first.'); process.exit(2); }
const args = process.argv.slice(2); const di = args.indexOf('--dir'); const dir = di >= 0 ? args.splice(di, 2)[1] : 'audio/momster';
const src = fs.readFileSync('tour.js', 'utf8');
const stepsSrc = src.slice(src.indexOf('const STEPS = ['), src.indexOf('// Fill in each chunk'));
const steps = []; // each step's chunk captions, in order
for (const blk of stepsSrc.split(/\n \{dur:/).slice(1)) steps.push([...blk.matchAll(/\[\s*[\d.]+,\s*"([^"]+)"/g)].map(m => m[1]));
const norm = s => String(s).toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter(Boolean);
const numWords = { '25': ['twenty', 'five'], '10': ['ten'], '5': ['five'] };
const expand = ws => ws.flatMap(w => numWords[w] || [w]);
for (const n of args) {
  const file = path.join(dir, `tour_${n}.mp3`), caps = steps[Number(n) - 1];
  if (!fs.existsSync(file) || !caps) { console.error(`no clip or captions for tour_${n}`); continue; }
  const form = new FormData(); form.append('model_id', 'scribe_v1'); form.append('timestamps_granularity', 'word');
  form.append('file', new Blob([fs.readFileSync(file)], { type: 'audio/mpeg' }), path.basename(file));
  const res = await fetch('https://api.elevenlabs.io/v1/speech-to-text', { method: 'POST', headers: { 'xi-api-key': key }, body: form });
  if (!res.ok) { console.error(`tour_${n}: speech-to-text answered ${res.status}`); continue; }
  const words = (await res.json()).words.filter(w => w.type === 'word').map(w => ({ t: expand(norm(w.text)), s: w.start }));
  const flat = words.flatMap(w => w.t.map(t => ({ t, s: w.s })));
  let p = 0; const starts = [];
  for (const cap of caps) { const toks = expand(norm(cap)); let found = -1;
    let best = 0;   // the first spot (after the last chunk) where most of the chunk's first six words line up
    for (let i = p; i < flat.length; i++) { let m = 0; for (let j = 0; j < Math.min(6, toks.length); j++) if (flat[i + j] && flat[i + j].t === toks[j]) m++;
      if (m > best) { best = m; found = i; } if (m >= Math.min(6, toks.length)) break; }
    if (best < Math.min(3, toks.length)) found = -1;
    if (found < 0) { console.error(`tour_${n}: could not find "${cap.slice(0, 30)}"`); starts.push(null); continue; }
    starts.push(flat[found].s); p = found + 1; }
  const dur = parseFloat(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]).toString());
  console.log(`tour_${n}: dur ${dur.toFixed(2)}  starts ${starts.map((s, i) => i === 0 ? '0' : s === null ? '??' : Math.max(0, s - 0.08).toFixed(2)).join(', ')}`);
}
