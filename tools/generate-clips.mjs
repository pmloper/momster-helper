// Generates the missing spoken lines with ElevenLabs text-to-speech, as review candidates.
//
//   node tools/generate-clips.mjs --voice momster --dry-run                    what would be generated, how many characters
//   node tools/generate-clips.mjs --voice momster --limit 10 --max-chars 2000  a small first run
//   node tools/generate-clips.mjs --voice all --takes 2 --max-chars 60000      everything, two takes per line
//
// Options:
//   --voice <folder|all>   momster, villains/<id>, or all (default all)
//   --takes <n>            takes per line (default 2); each take is one paid generation
//   --limit <n>            stop after n lines        --category <name>   only that category     --key <key>   only that line
//   --labels               also generate labels and text that is only shown (default: only lines the app plays)
//   --redo                 also regenerate lines that already have a final clip     --force   overwrite existing takes
//   --concurrency <n>      parallel requests (default 2; ElevenLabs limits this per plan)
//   --max-chars <n>        REQUIRED for a live run: stop before spending more than n characters (every take counts)
//   --out <dir>            where candidates go (default audio/_candidates)
//   --dry-run              print the plan and the cost, call nothing
//
// The key comes from the ELEVENLABS_API_KEY environment variable and is never printed or written. ELEVENLABS_BASE_URL overrides
// https://api.elevenlabs.io (used by the tests). Candidates land in <out>/<voice>/<key>/take<N>.mp3 with a meta.json beside them;
// nothing is copied into audio/<voice>/ until tools/promote-clips.mjs does it after review.
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const args = process.argv.slice(2);
const flag = n => args.includes('--' + n);
const opt = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : d; };
const VILLAINS = ['m_sock', 'm_crumb', 'm_dust', 'm_toy', 'm_slime', 'm_troll', 'm_booger', 'm_stink'];
const ALL_VOICES = ['momster', ...VILLAINS.map(v => 'villains/' + v)];

const parseCsv = text => { const rows = []; let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) { const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
    else if (c === '"') q = true; else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; } else if (c !== '\r') cur += c; }
  return rows; };
const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8')); } catch (e) { return d; } };

// ---- what to say: the line's text with emoji removed and a few spoken-word fixes, unless a respelling is in speak-overrides.json ----
const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}️‍]/gu;
export const speechText = (text, key, overrides = {}) => {
  let t = overrides[key] || text;
  t = t.replace(EMOJI, '').replace(/&/g, ' and ').replace(/\s+/g, ' ').trim();
  return t;
};
const hash = s => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h; };

// ---- which lines each voice still needs ----
export function plan({ voice, category, key, labels, redo }) {
  const [head, ...rows] = parseCsv(fs.readFileSync(path.join(ROOT, 'audio/lines.csv'), 'utf8'));
  const ix = Object.fromEntries(head.map((h, i) => [h, i]));
  const manifest = readJson('audio/manifest.json', {});
  const voices = voice === 'all' ? ALL_VOICES : [voice];
  const jobs = [];
  for (const r of rows) {
    if (!r[ix.key]) continue;
    if (!labels && !(r[ix.played_in_app] || '').startsWith('yes')) continue;
    if (category && r[ix.category] !== category) continue;
    if (key && r[ix.key] !== key) continue;
    const sp = r[ix.speaker] || 'momster';
    const wants = sp === 'momster' ? ['momster'] : sp === 'villains:any' ? VILLAINS.map(v => 'villains/' + v) : ['villains/' + sp];
    for (const v of wants) {
      if (!voices.includes(v)) continue;
      if (!redo && (manifest[v] || []).includes(r[ix.key])) continue;
      jobs.push({ voice: v, key: r[ix.key], category: r[ix.category], text: r[ix.text] });
    }
  }
  return jobs;
}

// ---- the request ----
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function synth({ base, apiKey, voiceId, body, format }) {
  for (let attempt = 0; attempt < 6; attempt++) {
    let res;
    try { res = await fetch(`${base}/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=${format}`, { method: 'POST', headers: { 'xi-api-key': apiKey, 'content-type': 'application/json', accept: 'audio/mpeg' }, body: JSON.stringify(body) }); }
    catch (e) { await sleep(1000 * 2 ** attempt); continue; }
    if (res.ok) return { audio: Buffer.from(await res.arrayBuffer()), requestId: res.headers.get('request-id') || res.headers.get('x-request-id') || '' };
    if (res.status === 429 || res.status >= 500) { const ra = Number(res.headers.get('retry-after')); await sleep(ra > 0 ? ra * 1000 : 1000 * 2 ** attempt); continue; }
    const detail = (await res.text().catch(() => '')).slice(0, 200);
    const err = new Error(`ElevenLabs answered ${res.status}: ${detail}`); err.status = res.status; throw err;
  }
  throw Object.assign(new Error('gave up after repeated rate-limit or server errors'), { status: 0 });
}

export async function main() {
  const voice = opt('voice', 'all'), takes = Math.max(1, Number(opt('takes', 2))), limit = Number(opt('limit', 0)) || Infinity;
  const out = path.resolve(ROOT, opt('out', 'audio/_candidates')), concurrency = Math.max(1, Number(opt('concurrency', 2)));
  const maxChars = Number(opt('max-chars', 0)), dry = flag('dry-run');
  if (voice !== 'all' && !ALL_VOICES.includes(voice)) { console.error(`Unknown voice "${voice}". Use one of: all, ${ALL_VOICES.join(', ')}`); return 2; }
  const cfg = readJson('audio/voices.json', null);
  if (!cfg) { console.error('audio/voices.json is missing.'); return 2; }
  const overrides = readJson('audio/speak-overrides.json', {});
  let jobs = plan({ voice, category: opt('category'), key: opt('key'), labels: flag('labels'), redo: flag('redo') });
  const seen = new Set(); jobs = jobs.filter(j => { const k = j.voice + '|' + j.key; if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, limit);
  for (const j of jobs) j.say = speechText(j.text, j.key, overrides);

  // todo = (voice, line, take) that does not exist yet
  const todo = [];
  for (const j of jobs) for (let n = 1; n <= takes; n++) {
    const f = path.join(out, j.voice, j.key, `take${n}.mp3`);
    if (flag('force') || !fs.existsSync(f)) todo.push({ ...j, take: n, file: f });
  }
  const chars = todo.reduce((a, t) => a + t.say.length, 0);
  const byVoice = {}; for (const t of todo) { const b = byVoice[t.voice] = byVoice[t.voice] || { clips: 0, chars: 0 }; b.clips++; b.chars += t.say.length; }
  console.log(`${jobs.length} lines, ${todo.length} generations to do (${takes} take${takes > 1 ? 's' : ''} each, existing takes skipped), ${chars} characters`);
  for (const [v, b] of Object.entries(byVoice)) console.log(`  ${v.padEnd(18)} ${String(b.clips).padStart(5)} generations  ${String(b.chars).padStart(7)} characters${cfg.voices?.[v]?.voice_id ? '' : '   (no voice_id in audio/voices.json yet)'}`);
  if (dry) { console.log('dry run: nothing was sent.'); return 0; }

  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) { console.error('Set ELEVENLABS_API_KEY in the environment first (the key is never read from a file).'); return 2; }
  if (!maxChars) { console.error(`A live run needs a spending limit: add --max-chars <n> (this plan is ${chars} characters).`); return 2; }
  const missingIds = [...new Set(todo.map(t => t.voice))].filter(v => !cfg.voices?.[v]?.voice_id);
  if (missingIds.length) { console.error('No voice_id in audio/voices.json for: ' + missingIds.join(', ')); return 2; }
  if (chars > maxChars) console.log(`Note: the plan is ${chars} characters but --max-chars is ${maxChars}; it will stop at the limit and can be re-run to continue.`);

  const base = (process.env.ELEVENLABS_BASE_URL || 'https://api.elevenlabs.io').replace(/\/$/, '');
  const ledger = path.join(out, 'ledger.jsonl'); fs.mkdirSync(out, { recursive: true });
  let spent = 0, done = 0, failed = 0, stop = null, next = 0;
  const worker = async () => {
    while (!stop) {
      const t = todo[next++]; if (!t) return;
      if (spent + t.say.length > maxChars) { stop = `reached --max-chars ${maxChars}`; return; }
      spent += t.say.length;                                   // count it before the call so parallel workers can't overshoot
      const v = cfg.voices[t.voice];
      const settings = { ...(cfg.defaults || {}), ...(cfg.categories?.[t.category] || {}), ...(v.settings || {}) };
      const body = { text: t.say, model_id: cfg.model_id || 'eleven_multilingual_v2', voice_settings: settings, seed: (hash(t.key) + t.take * 7919) % 4294967295 };
      try {
        const r = await synth({ base, apiKey, voiceId: v.voice_id, body, format: cfg.output_format || 'mp3_44100_128' });
        fs.mkdirSync(path.dirname(t.file), { recursive: true }); fs.writeFileSync(t.file, r.audio);
        fs.writeFileSync(path.join(path.dirname(t.file), 'meta.json'), JSON.stringify({ voice: t.voice, key: t.key, category: t.category, text: t.text, say: t.say, model_id: body.model_id, settings, generatedAt: new Date().toISOString() }, null, 1));
        fs.appendFileSync(ledger, JSON.stringify({ at: new Date().toISOString(), voice: t.voice, key: t.key, take: t.take, chars: t.say.length, bytes: r.audio.length, requestId: r.requestId }) + '\n');
        done++; if (done % 10 === 0 || done === todo.length) console.log(`  ${done}/${todo.length} done, ${spent} characters used`);
      } catch (e) {
        spent -= t.say.length; failed++;
        console.error(`  FAILED ${t.voice}/${t.key} take${t.take}: ${e.message}`);
        if ([401, 402, 403].includes(e.status)) stop = `stopped: ${e.message} (check the key, the plan's credits, and the voice permissions)`;
      }
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  console.log(`finished: ${done} generated, ${failed} failed, ${spent} characters used${stop ? ' (' + stop + ')' : ''}.`);
  return failed || stop ? 1 : 0;
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) main().then(c => process.exit(c));
