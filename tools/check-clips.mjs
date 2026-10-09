// Cleans up and checks the generated candidates so they can be reviewed fairly (same loudness, no dead air) and flags the odd ones.
//
//   node tools/check-clips.mjs                      process + check every take that has no .norm.mp3 yet
//   node tools/check-clips.mjs --transcribe         also play each take back through ElevenLabs speech-to-text and compare the words
//   node tools/check-clips.mjs --redo               process everything again
//   options: --out <dir> (default audio/_candidates)   --voice <folder>   --concurrency <n>
//
// For each <out>/<voice>/<key>/take<N>.mp3 it writes take<N>.norm.mp3 (silence trimmed at both ends, loudness levelled to -16 LUFS,
// mono, 96 kbps, a little tail so nothing is clipped) and records what looked wrong in <out>/report.json:
//   too-short / too-long   the clip is much shorter or longer than the text would take to say
//   clipping               the loudest peak is within 0.3 dB of full scale
//   dead-air               more than 0.6 s of quiet inside or at the edges after trimming
//   words-differ           (with --transcribe) the transcript matches the text by less than 85%
// Needs ffmpeg and ffprobe on the PATH. --transcribe also needs ELEVENLABS_API_KEY (and honours ELEVENLABS_BASE_URL).
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';

const ROOT = process.cwd();
const KEY_NAMES = ['ELEVENLABS_API_KEY', 'ELEVEN_LABS_API', 'ELEVEN_LABS_API_KEY', 'XI_API_KEY'];
const API_KEY = KEY_NAMES.map(n => process.env[n]).find(Boolean);
const args = process.argv.slice(2);
const flag = n => args.includes('--' + n);
const opt = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : d; };
const out = path.resolve(ROOT, opt('out', 'audio/_candidates'));
const sh = (cmd, a) => new Promise(res => execFile(cmd, a, { maxBuffer: 1 << 26 }, (err, stdout, stderr) => res({ ok: !err, stdout, stderr })));

const norm = t => String(t).toLowerCase().replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ').trim();
export const similarity = (a, b) => {   // share of the expected words that were heard, in order (longest common subsequence)
  const x = norm(a).split(' ').filter(Boolean), y = norm(b).split(' ').filter(Boolean); if (!x.length) return 1;
  const dp = Array.from({ length: x.length + 1 }, () => new Array(y.length + 1).fill(0));
  for (let i = 1; i <= x.length; i++) for (let j = 1; j <= y.length; j++) dp[i][j] = x[i - 1] === y[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
  return dp[x.length][y.length] / Math.max(x.length, y.length);
};
const duration = async f => { const r = await sh('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]); return r.ok ? parseFloat(r.stdout) : NaN; };

async function transcribe(file) {
  const base = (process.env.ELEVENLABS_BASE_URL || 'https://api.elevenlabs.io').replace(/\/$/, '');
  const form = new FormData(); form.append('model_id', 'scribe_v1'); form.append('file', new Blob([fs.readFileSync(file)], { type: 'audio/mpeg' }), path.basename(file));
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(base + '/v1/speech-to-text', { method: 'POST', headers: { 'xi-api-key': API_KEY }, body: form });
    if (res.ok) return (await res.json()).text || '';
    if (res.status === 429 || res.status >= 500) { await new Promise(r => setTimeout(r, 1000 * 2 ** attempt)); continue; }
    throw Object.assign(new Error(`speech-to-text answered ${res.status}`), { status: res.status });
  }
  throw new Error('speech-to-text kept failing');
}

export async function main() {
  if (!(await sh('ffmpeg', ['-version'])).ok) { console.error('ffmpeg is not installed or not on the PATH.'); return 2; }
  const wantText = flag('transcribe');
  if (wantText && !API_KEY) { console.error('--transcribe needs ELEVENLABS_API_KEY (or ELEVEN_LABS_API) in the environment.'); return 2; }
  const only = opt('voice');
  const items = [];
  for (const voiceDir of fs.existsSync(out) ? walkVoices(out) : []) {
    if (only && voiceDir.voice !== only) continue;
    for (const key of fs.readdirSync(voiceDir.dir)) {
      const dir = path.join(voiceDir.dir, key), metaFile = path.join(dir, 'meta.json'); if (!fs.existsSync(metaFile)) continue;
      const meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
      for (const f of fs.readdirSync(dir)) { const m = /^take(\d+)\.mp3$/.exec(f); if (m) items.push({ voice: voiceDir.voice, key, take: +m[1], dir, file: path.join(dir, f), norm: path.join(dir, `take${m[1]}.norm.mp3`), meta }); }
    }
  }
  const reportFile = path.join(out, 'report.json');
  const report = fs.existsSync(reportFile) && !flag('redo') ? JSON.parse(fs.readFileSync(reportFile, 'utf8')) : {};
  let n = 0, flagged = 0, fail = 0, next = 0, stop = null;
  const worker = async () => { while (!stop) { const it = items[next++]; if (!it) return;
    const id = `${it.voice}/${it.key}/take${it.take}`;
    const have = fs.existsSync(it.norm) && report[id] && !flag('redo') && (!wantText || report[id].heard !== undefined);
    if (have) continue;
    const dB = '-50dB', trim = `silenceremove=start_periods=1:start_threshold=${dB}:start_silence=0.04`;
    if (!fs.existsSync(it.norm) || flag('redo')) {
      const r = await sh('ffmpeg', ['-y', '-v', 'error', '-i', it.file, '-af', `${trim},areverse,${trim},areverse,loudnorm=I=-16:TP=-1.5:LRA=11,apad=pad_dur=0.12`, '-ar', '44100', '-ac', '1', '-b:a', '96k', it.norm]);
      if (!r.ok) { console.error(`  could not process ${id}: ${r.stderr.split('\n')[0]}`); fail++; continue; }
    }
    const dur = await duration(it.norm), chars = (it.meta.say || it.meta.text || '').length, flags = [];
    const expected = Math.max(0.5, chars / 14);             // about 14 characters a second at a lively reading pace
    if (!(dur >= expected * 0.45)) flags.push('too-short'); if (dur > expected * 2.6 + 1) flags.push('too-long');
    const vol = await sh('ffmpeg', ['-v', 'info', '-i', it.file, '-af', 'volumedetect', '-f', 'null', '-']);
    const peak = /max_volume: (-?[\d.]+) dB/.exec(vol.stderr); if (peak && parseFloat(peak[1]) >= -0.3) flags.push('clipping');
    const sil = await sh('ffmpeg', ['-v', 'info', '-i', it.norm, '-af', 'silencedetect=noise=-45dB:d=0.6', '-f', 'null', '-']);
    if (/silence_start/.test(sil.stderr)) flags.push('dead-air');
    const rec = { seconds: +dur.toFixed(2), flags };
    if (wantText) { try { rec.heard = await transcribe(it.norm); rec.match = +similarity(it.meta.say || it.meta.text, rec.heard).toFixed(2); if (rec.match < 0.85) rec.flags.push('words-differ'); }
      catch (e) { console.error(`  transcript failed for ${id}: ${e.message}`); if ([401, 402, 403].includes(e.status)) stop = e.message; } }
    report[id] = rec; n++; if (rec.flags.length) flagged++;
    if (n % 25 === 0) console.log(`  ${n} processed`);
  } };
  await Promise.all(Array.from({ length: Math.max(1, Number(opt('concurrency', 3))) }, worker));
  fs.writeFileSync(reportFile, JSON.stringify(report, null, 1));
  console.log(`processed ${n} take${n === 1 ? '' : 's'}, ${flagged} flagged, ${fail} failed; report: ${path.relative(ROOT, reportFile)}`);
  return fail || stop ? 1 : 0;
}
function walkVoices(root) {   // momster, villains/<id>
  const res = [];
  for (const d of fs.readdirSync(root, { withFileTypes: true })) { if (!d.isDirectory() || d.name === 'review') continue;
    if (d.name === 'villains') for (const v of fs.readdirSync(path.join(root, d.name))) res.push({ voice: 'villains/' + v, dir: path.join(root, d.name, v) });
    else res.push({ voice: d.name, dir: path.join(root, d.name) }); }
  return res;
}
if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) main().then(c => process.exit(c));
