// Local checks for v62-joke: jod taps (card, Tell me!, Tell it again) play full setup->boing->punchline;
// bottom-nav Joke still plays setup only. SW CACHE bumped to a unique v62-joke
// name to avoid cross-candidate Preview alias collisions. Inline JS must parse.
// Exits non-zero on any failure.
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

let fails = 0;
const chk = (c, m) => { console.log((c ? 'OK:   ' : 'ERROR: ') + m); if (!c) fails++; };

const repoDir = process.cwd();
const html = fs.readFileSync(path.join(repoDir, 'index.html'), 'utf8');
const sw = fs.readFileSync(path.join(repoDir, 'sw.js'), 'utf8');

// 1. SW CACHE: unique, v62-joke, present in code.
chk(sw.includes('const CACHE = "momster-helper-v62-joke";'),
    'sw.js CACHE bumped to momster-helper-v62-joke (distinct from prior v61-prize-fix)');
chk(!sw.includes('momster-helper-v61-prize-fix'),
    'sw.js no longer references stale v61-prize-fix cache');

// 2. jod handler plays full joke, regardless of jodOpen / card-vs-sheet origin.
const jodLine = html.split(/\r?\n/).find(l => l.includes('case "jod":')) || '';
chk(jodLine.includes('play(["BJ:"+j[0],"boing","BJ:"+j[1]])'),
    'case "jod" plays setup, boing, punchline (full joke on every tap)');
chk(jodLine.includes('jodOpen=true'),
    'jod handler still flips jodOpen (visual reveal flag, not audio branching)');
// No answer-only branch remains in the jod handler.
chk(!jodLine.includes('["BJ:"+j[1],"boing"]'),
    'no answer-only branch in jod handler');
chk(!/fromCard\s*=/.test(jodLine),
    'no fromCard flag in jod handler (order is unconditional)');
// There is only one case "jod" line (no shim for old code path).
chk(html.split('case "jod":').length === 2,
    'single case "jod" handler (no duplicate/old branch)');

// 3. bottom-nav jokeSheet still plays only the setup.
const jsLine = html.split(/\r?\n/).find(l => l.includes('case "jokeSheet":')) || '';
chk(jsLine.includes('play(["BJ:"+j[0]])'),
    'case "jokeSheet" still plays setup only (unchanged)');
// Make sure we did not accidentally queue the punchline on jokeSheet.
chk(!jsLine.includes('BJ:"+j[1]'),
    'case "jokeSheet" does NOT queue punchline (setup-only preserved)');

// 4. jokeSheet() render: still branches on jodOpen for visual reveal only.
chk(html.includes('${jodOpen?`<p class="ja">${esc(j[1])}</p><button class="btn ghost" data-a="jod">🔁 Tell it again</button>`:`<button class="btn primary" data-a="jod"'),
    'jokeSheet() render still branches on jodOpen for visual reveal (Tell me! vs Tell it again)');

// 5. jokeCard() render still uses jodOpen for show/hide of punchline.
chk(html.includes('${jodOpen?`<strong>${esc(j[1])}</strong>`:`<i>Tap for the answer!</i>`}'),
    'jokeCard() render still uses jodOpen for visual punchline swap');

// 6. Inline <script> blocks must all parse as valid JS (uses node --check).
const blocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
chk(blocks.length > 0, `found ${blocks.length} inline <script> blocks`);
const tmpFile = path.join(repoDir, '.tmp_inline_check.js');
try {
  fs.writeFileSync(tmpFile, blocks.join('\n;\n'));
  execSync(`node --check ${JSON.stringify(tmpFile)}`, { stdio: 'pipe' });
  chk(true, 'all inline <script> blocks parse cleanly under node --check');
} catch (e) {
  chk(false, 'inline <script> blocks failed to parse: ' + (e.stderr ? e.stderr.toString() : e.message));
} finally {
  try { fs.unlinkSync(tmpFile); } catch (e) {}
}

// 7. Unrelated voice playback preserved — sanity check that no
// play/cancel/speak paths were touched outside the jod handler.
const playFnLine = html.split(/\r?\n/).find(l => /function\s+play\s*\(/.test(l)) || '';
chk(/function\s+play\s*\(/.test(html),
    'play() function still present (voice playback pipeline intact)');
chk(/speechSynthesis\.(speak|cancel)/.test(html),
    'speechSynthesis speak/cancel still present (TTS pipeline intact)');
// We did NOT modify the CLIPS map (audio assets untouched).
chk(/const\s+CLIPS\s*=/.test(html),
    'CLIPS asset map still present (audio assets untouched)');
// We did NOT introduce a new voice-selector or sound-menu change here.
chk(!/data-a="voiceSheet"/.test(html) || html.match(/data-a="voiceSheet"/g).length === html.match(/data-a="sound"/g).length,
    'voice/sound menu entry points unchanged');

console.log(fails ? `\n${fails} FAILURE(S)` : '\nALL OK');
process.exit(fails ? 1 : 0);
