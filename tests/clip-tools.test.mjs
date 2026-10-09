// The review pipeline after generation: tools/check-clips.mjs (level, trim, flag), tools/build-review-page.mjs, tools/promote-clips.mjs.
// Uses short tones made with ffmpeg and a stand-in speech-to-text server (no key, no cost). Skipped if ffmpeg is not installed.
// Usage: node tests/clip-tools.test.mjs
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile, execFileSync } from 'node:child_process';

const REPO = path.resolve(import.meta.dirname, '..');
let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); } catch (e) { console.log('SKIP ffmpeg is not installed'); process.exit(0); }
const run = (cwd, script, args, env = {}) => new Promise(r => execFile(process.execPath, [path.join(REPO, 'tools', script), ...args], { cwd, env: { ...process.env, ...env } }, (err, stdout, stderr) => r({ code: err ? err.code : 0, out: stdout + stderr })));
const tone = (file, graph) => execFileSync('ffmpeg', ['-y', '-v', 'quiet', '-filter_complex', graph, '-map', '[o]', '-b:a', '128k', file], { stdio: 'ignore' });
const probe = f => parseFloat(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).toString());

const w = fs.mkdtempSync(path.join(os.tmpdir(), 'mh-clip-')); fs.mkdirSync(path.join(w, 'audio'), { recursive: true }); fs.writeFileSync(path.join(w, 'audio/speak-overrides.json'), '{}');
const cand = path.join(w, 'audio/_candidates');
const make = (voice, key, text, category, take, graph) => { const d = path.join(cand, voice, key); fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, 'meta.json'), JSON.stringify({ voice, key, text, say: text, category })); tone(path.join(d, `take${take}.mp3`), graph); };
// good: 1.3 s of tone with 0.4 s of silence in front and 0.6 s behind
make('momster', 'good', 'Hello there kids', 'cheer', 1, 'sine=frequency=440:duration=1.3,volume=0.3,adelay=400|400,apad=pad_dur=0.6[o]');
make('momster', 'good', 'Hello there kids', 'cheer', 2, 'sine=frequency=330:duration=1.2,volume=0.3[o]');
make('momster', 'loud', 'Hello there kids', 'cheer', 1, 'sine=frequency=440:duration=1.2,volume=20,alimiter=limit=1:attack=0.1:release=1[o]');
make('momster', 'long', 'Hi!', 'cheer', 1, 'sine=frequency=440:duration=9[o]');
make('villains/m_sock', 'gap', 'Hello there kids', 'villain taunt', 1, 'sine=d=0.7[a];anullsrc=d=2.2[b];sine=d=0.7[c];[a][b][c]concat=n=3:v=0:a=1[o]');

// ---- check-clips ----
let r = await run(w, 'check-clips.mjs', []);
const rep = JSON.parse(fs.readFileSync(path.join(cand, 'report.json'), 'utf8'));
ok(r.code === 0 && Object.keys(rep).length === 5, 'every take is processed and reported: ' + r.out.trim().split('\n').pop());
ok(['momster/good/take1', 'momster/good/take2', 'momster/loud/take1', 'momster/long/take1', 'villains/m_sock/gap/take1'].every(id => fs.existsSync(path.join(cand, id + '.norm.mp3'))), 'a levelled .norm.mp3 sits next to each take');
const good = probe(path.join(cand, 'momster/good/take1.norm.mp3'));
ok(good > 1.2 && good < 1.75, 'silence is trimmed from both ends (2.3 s in, ' + good.toFixed(2) + ' s out)');
ok(rep['momster/good/take1'].flags.length === 0 && rep['momster/good/take2'].flags.length === 0, 'a normal clip is not flagged: ' + JSON.stringify(rep['momster/good/take1'].flags));
ok(rep['momster/loud/take1'].flags.includes('clipping'), 'a clip that touches full scale is flagged as clipping');
ok(rep['momster/long/take1'].flags.includes('too-long'), 'a clip far longer than its text is flagged too-long');
ok(rep['villains/m_sock/gap/take1'].flags.includes('dead-air'), 'a long pause in the middle is flagged dead-air');
r = await run(w, 'check-clips.mjs', []);
ok(/processed 0 takes/.test(r.out), 'running it again does no work');

// ---- transcription (stand-in server) ----
const said = { good: 'hello there kids', loud: 'a completely different sentence about trains' };
const reqs = [];
const srv = http.createServer((req, res) => { let n = 0; req.on('data', d => n += d.length); req.on('end', () => { reqs.push({ url: req.url, key: req.headers['xi-api-key'], n });
  const k = reqs.length <= 2 ? 'good' : 'loud'; res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ text: said[k] })); }); });
await new Promise(rr => srv.listen(0, '127.0.0.1', rr));
r = await run(w, 'check-clips.mjs', ['--transcribe', '--voice', 'momster', '--concurrency', '1'], { ELEVENLABS_API_KEY: 'sk-test-xyz', ELEVENLABS_BASE_URL: `http://127.0.0.1:${srv.address().port}` });
const rep2 = JSON.parse(fs.readFileSync(path.join(cand, 'report.json'), 'utf8'));
ok(reqs.length >= 3 && reqs.every(q => q.url === '/v1/speech-to-text' && q.key === 'sk-test-xyz'), 'each take is played back through speech-to-text (' + reqs.length + ' requests)');
const matches = Object.entries(rep2).filter(([k, v]) => v.match !== undefined);
ok(matches.some(([k, v]) => v.match === 1) && matches.some(([k, v]) => v.flags.includes('words-differ')), 'matching words score 100%, different words are flagged words-differ');
srv.close();
r = await run(w, 'check-clips.mjs', ['--transcribe']);
ok(r.code === 2 && /ELEVENLABS_API_KEY/.test(r.out), '--transcribe without a key is refused');

// ---- review page ----
r = await run(w, 'build-review-page.mjs', []);
const page = fs.readFileSync(path.join(cand, 'review/index.html'), 'utf8');
ok(/5 lines|4 lines/.test(r.out) && ['good', 'loud', 'long', 'gap'].every(k => page.includes(k)) && page.includes('../momster/good/take1.norm.mp3'), 'the page lists every line and points at the levelled takes: ' + r.out.trim());
const script = page.match(/<script>([\s\S]*)<\/script>/)[1];
let parses = true; try { new Function(script); } catch (e) { parses = false; }
ok(parses && page.includes('Download decisions.json') && !page.includes('sk-test'), 'the page script parses, has the download button and holds no key');

// ---- promote ----
fs.writeFileSync(path.join(w, 'decisions.json'), JSON.stringify({ 'momster/good': { pick: 2, respell: 'Hell-o there, kids' }, 'momster/long': { redo: true }, 'villains/m_sock/gap': { pick: 1 } }));
r = await run(w, 'promote-clips.mjs', ['decisions.json', '--dry-run']);
ok(/\[dry run\] 2 clips promoted, 1 queued for redo/.test(r.out) && !fs.existsSync(path.join(w, 'audio/momster/good.mp3')) && fs.existsSync(path.join(cand, 'momster/long')), 'a dry run changes nothing');
r = await run(w, 'promote-clips.mjs', ['decisions.json']);
ok(/2 clips promoted, 1 queued for redo, 1 respellings saved/.test(r.out) && fs.existsSync(path.join(w, 'audio/momster/good.mp3')) && fs.existsSync(path.join(w, 'audio/villains/m_sock/gap.mp3')), 'picked takes are copied into audio/<voice>/<key>.mp3');
ok(Math.abs(probe(path.join(w, 'audio/momster/good.mp3')) - probe(path.join(cand, 'momster/good/take2.norm.mp3'))) < 0.05, 'the levelled version of the picked take is the one shipped');
ok(!fs.existsSync(path.join(cand, 'momster/long')), 'a redo clears that line\'s candidates so the next generation makes new ones');
ok(JSON.parse(fs.readFileSync(path.join(w, 'audio/speak-overrides.json'), 'utf8')).good === 'Hell-o there, kids', 'a respelling is saved to speak-overrides.json under the line\'s key');
const man = JSON.parse(fs.readFileSync(path.join(w, 'audio/manifest.json'), 'utf8'));
ok(man.momster.includes('good') && man['villains/m_sock'].includes('gap'), 'the manifest is rebuilt to include the new clips');

fs.rmSync(w, { recursive: true, force: true });
console.log(fails ? `\nFAILED: ${fails} check(s)` : '\nALL PASS');
process.exit(fails ? 1 : 0);
