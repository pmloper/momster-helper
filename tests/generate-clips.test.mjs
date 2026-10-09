// tools/generate-clips.mjs against a stand-in ElevenLabs server (no key, no network, no cost).
//   * dry run sends nothing and counts the right lines; a live run needs a key, a spending limit and voice ids
//   * requests have the right path, header, settings, seed and cleaned text; takes land where the review step expects them
//   * it resumes without paying twice, retries rate limits, stops on a bad key, honours the spending limit
//   * a shared villain line is generated once per villain; the key never appears in output or files
// Usage: node tests/generate-clips.test.mjs
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';

const REPO = path.resolve(import.meta.dirname, '..');
let fails = 0;
// the tests must not pick up a real key (or proxy) from the machine they run on
const cleanEnv = () => { const e = { ...process.env }; for (const k of ['ELEVENLABS_API_KEY', 'ELEVEN_LABS_API', 'ELEVEN_LABS_API_KEY', 'XI_API_KEY', 'HTTPS_PROXY', 'https_proxy']) delete e[k]; return e; };
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const KEY = 'sk-test-DO-NOT-LEAK-1234';

const requests = [];
let behaviour = () => ({ status: 200 });
const server = http.createServer((req, res) => {
  let body = ''; req.on('data', d => body += d); req.on('end', () => {
    const parsed = body ? JSON.parse(body) : null; requests.push({ method: req.method, url: req.url, headers: req.headers, body: parsed });
    const b = behaviour(parsed, requests.length);
    res.writeHead(b.status, { 'content-type': b.status === 200 ? 'audio/mpeg' : 'application/json', 'request-id': 'req_' + requests.length, ...(b.headers || {}) });
    res.end(b.status === 200 ? Buffer.from('ID3-fake-audio-' + (parsed ? parsed.text.length : 0)) : JSON.stringify({ detail: b.detail || 'nope' }));
  });
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

function workdir() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'mh-gen-')); fs.mkdirSync(path.join(d, 'audio'), { recursive: true });
  for (const f of ['lines.csv', 'manifest.json']) fs.copyFileSync(path.join(REPO, 'audio', f), path.join(d, 'audio', f));
  const cfg = JSON.parse(fs.readFileSync(path.join(REPO, 'audio/voices.json'), 'utf8'));
  for (const [k, v] of Object.entries(cfg.voices)) v.voice_id = 'voice_' + k.replace('/', '_');
  fs.writeFileSync(path.join(d, 'audio/voices.json'), JSON.stringify(cfg));
  fs.writeFileSync(path.join(d, 'audio/speak-overrides.json'), '{}');
  return d;
}
const run = (cwd, args, env = {}) => new Promise(resolve => execFile(process.execPath, [path.join(REPO, 'tools/generate-clips.mjs'), ...args], { cwd, env: { ...cleanEnv(), ELEVENLABS_BASE_URL: base, ...env } }, (err, stdout, stderr) => resolve({ code: err ? err.code : 0, out: stdout + stderr })));
const withKey = { ELEVENLABS_API_KEY: KEY };
const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);

// ---- dry run and refusals ----
let w = workdir(), r;
r = await run(w, ['--voice', 'all', '--dry-run']);
const dry = /(\d+) lines, (\d+) need their own clip \((\d+) repeat.*?, (\d+) generations to do.*?, (\d+) characters/.exec(r.out);
ok(r.code === 0 && dry && +dry[4] === 2 * +dry[2] && +dry[1] === +dry[2] + +dry[3] && requests.length === 0, 'a dry run counts the lines, the repeats and 2 takes each, and sends nothing: ' + r.out.split('\n')[0]);
r = await run(w, ['--voice', 'momster', '--limit', '2']);
ok(r.code === 2 && /ELEVENLABS_API_KEY/.test(r.out) && requests.length === 0, 'a live run without a key is refused');
r = await run(w, ['--voice', 'momster', '--limit', '2'], withKey);
ok(r.code === 2 && /--max-chars/.test(r.out) && requests.length === 0, 'a live run without a spending limit is refused');
{ const blank = JSON.parse(fs.readFileSync(path.join(REPO, 'audio/voices.json'), 'utf8')); for (const v of Object.values(blank.voices)) v.voice_id = ''; fs.writeFileSync(path.join(w, 'audio/voices.json'), JSON.stringify(blank)); }
r = await run(w, ['--voice', 'momster', '--limit', '2', '--max-chars', '1000'], withKey);
ok(r.code === 2 && /No voice_id/.test(r.out) && requests.length === 0, 'a voice with no voice_id is refused before any request');
r = await run(w, ['--voice', 'nobody', '--dry-run']);
ok(r.code === 2 && /Unknown voice/.test(r.out), 'an unknown voice name is refused');

// ---- lines with the same words share one clip ----
w = workdir(); requests.length = 0;
fs.writeFileSync(path.join(w, 'audio/lines.csv'), 'key,voice_folder,category,text,status,played_in_app,note,exact_app_text,speaker\na1,momster,x,"Whoever smelt it, DEALT it!",NEW,yes,,,momster\na2,momster,y,"Whoever smelt it, dealt it!",NEW,yes,,,momster\na3,momster,y,Something else.,NEW,yes,,,momster\n');
fs.writeFileSync(path.join(w, 'audio/manifest.json'), '{}');
r = await run(w, ['--voice', 'momster', '--takes', '1', '--max-chars', '500'], withKey);
ok(requests.length === 2 && /3 lines, 2 need their own clip \(1 repeat/.test(r.out), 'two lines with the same words are generated once: ' + requests.length + ' requests');
ok(JSON.parse(fs.readFileSync(path.join(w, 'audio/_candidates/momster/a1/meta.json'), 'utf8')).aliases.join() === 'a2', 'the repeat is recorded as an alias in meta.json');

// ---- the key can be stored under the other names ----
w = workdir(); requests.length = 0;
r = await run(w, ['--voice', 'momster', '--limit', '1', '--takes', '1', '--max-chars', '500'], { ELEVEN_LABS_API: KEY });
ok(r.code === 0 && requests.length === 1 && requests[0].headers['xi-api-key'] === KEY && !r.out.includes(KEY), 'the key is found under ELEVEN_LABS_API too, and still never printed');

// ---- a small live run ----
w = workdir(); requests.length = 0;
r = await run(w, ['--voice', 'momster', '--limit', '3', '--takes', '2', '--max-chars', '5000'], withKey);
ok(r.code === 0 && requests.length === 6, 'three lines x two takes = six requests: ' + requests.length);
const q = requests[0];
ok(q.method === 'POST' && q.url.startsWith('/v1/text-to-speech/voice_momster?output_format=mp3_44100_128') && q.headers['xi-api-key'] === KEY, 'right endpoint, voice and key header: ' + q.url);
ok(q.body.model_id === 'eleven_multilingual_v2' && q.body.voice_settings.stability > 0 && typeof q.body.seed === 'number', 'model, voice settings and a seed are sent');
const seeds = requests.map(x => x.body.seed + '|' + x.body.text); ok(new Set(seeds).size >= 4, 'each take gets its own seed');
const files = walk(path.join(w, 'audio/_candidates')).map(f => path.relative(path.join(w, 'audio/_candidates'), f));
ok(files.filter(f => /take[12]\.mp3$/.test(f)).length === 6 && files.filter(f => f.endsWith('meta.json')).length === 3, 'takes and a meta.json per line land under audio/_candidates/<voice>/<key>/');
ok(fs.readFileSync(path.join(w, 'audio/_candidates/ledger.jsonl'), 'utf8').trim().split('\n').length === 6, 'every generation is written to the ledger');
const everything = r.out + walk(w).map(f => fs.readFileSync(f, 'latin1')).join('');
ok(!everything.includes(KEY), 'the key appears nowhere in the output or in any file');

// ---- resume, no double spend ----
requests.length = 0; r = await run(w, ['--voice', 'momster', '--limit', '3', '--takes', '2', '--max-chars', '5000'], withKey);
ok(requests.length === 0 && /0 generations to do/.test(r.out), 'running it again makes no requests');
requests.length = 0; r = await run(w, ['--voice', 'momster', '--limit', '3', '--takes', '3', '--max-chars', '5000'], withKey);
ok(requests.length === 3, 'asking for a third take generates only the new takes: ' + requests.length);

// ---- text cleanup and overrides ----
w = workdir(); requests.length = 0;
const intro = 'Urgent message! A villain has invaded the house: Captain Crumbs.';
r = await run(w, ['--voice', 'momster', '--category', 'villain intro', '--takes', '1', '--max-chars', '9000'], withKey);
ok(requests.length === 8 && requests.every(x => !/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(x.body.text)) && !requests.some(x => /jobs jobs/.test(x.body.text)), 'the eight villain announcements go out as clean text, no emoji and no "jobs jobs"');
ok(requests.some(x => x.body.text.includes('laundry and socks')), 'an ampersand is spoken as "and"');
const cat = requests[0].body.voice_settings; ok(cat.style === 0.3, 'categories without settings use the defaults');
requests.length = 0;
const keyOfLine = 'great'; fs.writeFileSync(path.join(w, 'audio/speak-overrides.json'), JSON.stringify({ [keyOfLine]: 'Gr-eight job!' }));
r = await run(w, ['--voice', 'momster', '--key', keyOfLine, '--takes', '1', '--max-chars', '500'], withKey);
ok(requests.length === 1 && requests[0].body.text === 'Gr-eight job!' && fs.existsSync(path.join(w, 'audio/_candidates/momster/great/take1.mp3')), 'a respelling in speak-overrides.json is what gets said, filed under the original key');

// ---- shared villain lines: one per villain ----
w = workdir(); requests.length = 0;
const shared = fs.readFileSync(path.join(REPO, 'audio/lines.csv'), 'utf8').split('\n').find(l => l.endsWith(',villains:any') && /villain mood/.test(l)).split(',')[0];
r = await run(w, ['--voice', 'all', '--key', shared, '--takes', '1', '--max-chars', '2000'], withKey);
const ids = requests.map(x => x.url.split('/')[3].split('?')[0]).sort();
ok(requests.length === 8 && new Set(ids).size === 8 && ids.every(i => i.startsWith('voice_villains_')), 'a line every villain can say is generated once in each of the eight villain voices');
ok(requests.every(x => x.body.voice_settings.style === 0.65), 'villain lines use the more expressive category settings');

// ---- failures ----
w = workdir(); requests.length = 0; let first = true;
behaviour = () => { if (first) { first = false; return { status: 429, headers: { 'retry-after': '0' } }; } return { status: 200 }; };
r = await run(w, ['--voice', 'momster', '--limit', '2', '--takes', '1', '--max-chars', '2000'], withKey);
ok(r.code === 0 && requests.length === 3 && walk(path.join(w, 'audio/_candidates')).filter(f => f.endsWith('take1.mp3')).length === 2, 'a rate-limit (429) is retried and nothing is lost');
w = workdir(); requests.length = 0; behaviour = () => ({ status: 401 });
r = await run(w, ['--voice', 'momster', '--limit', '20', '--takes', '1', '--max-chars', '9000', '--concurrency', '1'], withKey);
ok(r.code === 1 && requests.length === 1 && /check the key/.test(r.out), 'a bad key (401) stops the whole run after one request');
behaviour = () => ({ status: 401, detail: 'Only one of xi-api-key and authorization headers must be provided. Received both headers.' });
w = workdir(); requests.length = 0;
r = await run(w, ['--voice', 'momster', '--limit', '3', '--takes', '1', '--max-chars', '9000', '--concurrency', '1'], withKey);
ok(r.code === 1 && requests.length === 1 && /Network secrets/.test(r.out), 'if a proxy adds its own Authorization header the error says how to fix the environment');
behaviour = () => ({ status: 200 });
w = workdir(); requests.length = 0;
r = await run(w, ['--voice', 'momster', '--limit', '50', '--takes', '1', '--max-chars', '60', '--concurrency', '1'], withKey);
const sent = requests.reduce((a, x) => a + x.body.text.length, 0);
ok(sent <= 60 && requests.length >= 1 && /max-chars/.test(r.out), 'the spending limit is never exceeded (' + sent + ' of 60 characters)');

server.close();
console.log(fails ? `\nFAILED: ${fails} check(s)` : '\nALL PASS');
process.exit(fails ? 1 : 0);
