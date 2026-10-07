// Local syntax + structure checks for the v59 polish (kept current for v69-kid-header build).
import fs from 'node:fs';
import path from 'node:path';

const repoDir = process.cwd();
console.log('repo:', repoDir);

const html = fs.readFileSync(path.join(repoDir, 'index.html'), 'utf8');
const lines = html.split(/\r?\n/);
console.log('lines', lines.length);

const scriptTagCount = (html.match(/<script\b/g) || []).length;
console.log('script tag count:', scriptTagCount);

// CACHE check (v69-kid-header Preview)
const sw = fs.readFileSync(path.join(repoDir, 'sw.js'), 'utf8');
console.log(sw.includes('momster-helper-v69-kid-header') ? 'OK: CACHE v69-kid-header' : 'ERROR: CACHE not v69-kid-header');

// wizSheet routing
const routed = html.includes('paintSheet("wizSheet"');
console.log(routed ? 'OK: wizSheet routed through paintSheet' : 'ERROR: wizSheet not routed');

// Step 4 subtitle parenthesization
// Readers caption is always visible (no selection-conditional hide), per Paul clarification in
// Momster thread message 1557135149294948454.
const step4a = html.includes('"📖 My kids can read", "(Words on screen + voice)"');
console.log(step4a ? 'OK: step 4 first subtitle always-visible & parenthesized' : 'ERROR: step 4 first subtitle not always-visible / not parenthesized');
// Nonreaders: "(Everything read out loud)" is in the bold label next to "Not yet"; small subtitle is empty.
const step4b = html.includes('"👂", "Not yet (Everything read out loud)", ""');
console.log(step4b ? 'OK: step 4 Not yet label includes (Everything read out loud)' : 'ERROR: step 4 Not yet label missing parens');
// "Bigger buttons" string must be gone everywhere in index.html.
const biggerGone = !html.includes('Bigger buttons');
console.log(biggerGone ? 'OK: step 4 Bigger buttons line removed' : 'ERROR: step 4 Bigger buttons still present');

// Step 5 justify-content:center on wizard-scoped seg button
const step5 = html.includes('#wizSheet .seg .btn, #wizSheet .seg button{min-height:42px;font-size:14px;padding:5px 8px;justify-content:center}');
console.log(step5 ? 'OK: wizSheet seg pill has justify-content:center' : 'ERROR: wizSheet seg pill missing justify-content:center');

// Untouched rules sanity
const wjrowBorder = html.match(/#wizSheet \.wjrow\{[^}]*border-bottom[^}]*\}/);
console.log(wjrowBorder ? 'WARN: wjrow border-bottom still present (regression)' : 'OK: wjrow border-bottom untouched (v57 fix preserved)');
const wizjobOnBorder = html.includes('.wizjob.on{border-color:var(--doneInk)');
console.log(wizjobOnBorder ? 'OK: .wizjob.on border rule untouched' : 'ERROR: .wizjob.on border rule altered');

// Parse the LAST inline <script> block (the main app bundle is the last one; earlier ones are short initialiser/loader fragments).  Use [\s\S]*? non-greedy with global to grab every block, then concatenate them all and parse; this matches what a browser would actually execute.
const blocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
console.log('inline script blocks:', blocks.length);
const all = blocks.join('\n;\n');
console.log('combined inline script length:', all.length);
try {
  new Function(all);
  console.log('OK: combined inline scripts parse cleanly');
} catch (e) {
  console.error('PARSE ERROR:', e.message);
  process.exit(1);
}
