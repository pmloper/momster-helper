// Applies your review decisions: copies the picked takes into audio/<voice>/<key>.mp3, queues redos, and records respellings.
//
//   node tools/promote-clips.mjs decisions.json [--out audio/_candidates] [--dry-run]
//
// decisions.json comes from the review page: { "<voice>/<key>": { "pick": 2 } | { "redo": true } , "respell": "how to say it" }
//   pick     the take to ship. The levelled take<N>.norm.mp3 is used when it exists, otherwise take<N>.mp3.
//   redo     deletes this line's takes (and any candidate files) so the next  tools/generate-clips.mjs  run makes fresh ones.
//   respell  written to audio/speak-overrides.json under the line's key; the next generation says it that way.
// Rebuilds audio/manifest.json at the end. Run  node tools/missing-clips.mjs  to see what is still outstanding.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = process.cwd();
const args = process.argv.slice(2);
const outAt = args.indexOf('--out');
const file = args.find((a, i) => !a.startsWith('--') && !(outAt >= 0 && i === outAt + 1));
const opt = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : d; };
const dry = args.includes('--dry-run');
if (!file) { console.error('Usage: node tools/promote-clips.mjs decisions.json [--out audio/_candidates] [--dry-run]'); process.exit(2); }
const out = path.resolve(ROOT, opt('out', 'audio/_candidates'));
const decisions = JSON.parse(fs.readFileSync(path.resolve(ROOT, file), 'utf8'));
const ovFile = path.join(ROOT, 'audio/speak-overrides.json');
const overrides = fs.existsSync(ovFile) ? JSON.parse(fs.readFileSync(ovFile, 'utf8')) : {};

let promoted = 0, redo = 0, respelled = 0, problems = 0;
for (const [id, d] of Object.entries(decisions)) {
  const slash = id.lastIndexOf('/'), voice = id.slice(0, slash), key = id.slice(slash + 1), dir = path.join(out, voice, key);
  if (d.respell) { overrides[key] = d.respell; respelled++; }
  if (d.redo) { if (!dry) fs.rmSync(dir, { recursive: true, force: true }); redo++; continue; }
  if (!d.pick) continue;
  const src = [`take${d.pick}.norm.mp3`, `take${d.pick}.mp3`].map(f => path.join(dir, f)).find(f => fs.existsSync(f));
  if (!src) { console.error(`  missing take ${d.pick} for ${id}`); problems++; continue; }
  if (!dry) { fs.mkdirSync(path.join(ROOT, 'audio', voice), { recursive: true }); fs.copyFileSync(src, path.join(ROOT, 'audio', voice, key + '.mp3')); }
  promoted++;
}
if (!dry) {
  if (respelled) fs.writeFileSync(ovFile, JSON.stringify(overrides, null, 2) + '\n');
  execFileSync(process.execPath, [path.join(import.meta.dirname, 'build-audio-manifest.mjs')], { cwd: ROOT, stdio: 'ignore' });
}
console.log(`${dry ? '[dry run] ' : ''}${promoted} clips promoted, ${redo} queued for redo, ${respelled} respellings saved${problems ? `, ${problems} problems` : ''}.`);
process.exit(problems ? 1 : 0);
