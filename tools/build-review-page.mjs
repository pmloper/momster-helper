// Builds a listening page for the generated candidates: <out>/review/index.html (plus data), to open in a browser or zip and send.
//
//   node tools/build-review-page.mjs [--out audio/_candidates] [--voice <folder>]
//
// For each line it shows the text, a player for every take (the levelled .norm.mp3 when there is one), what tools/check-clips.mjs
// flagged, and: which take to use (or none), a "redo this line" box, and a "say it like this" respelling box.
// Decisions are kept in the browser as you go and saved with "Download decisions.json" -> pass that file to tools/promote-clips.mjs.
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : d; };
const out = path.resolve(ROOT, opt('out', 'audio/_candidates')), only = opt('voice');
const report = fs.existsSync(path.join(out, 'report.json')) ? JSON.parse(fs.readFileSync(path.join(out, 'report.json'), 'utf8')) : {};

const lines = [];
const voices = []; for (const d of fs.existsSync(out) ? fs.readdirSync(out, { withFileTypes: true }) : []) { if (!d.isDirectory() || d.name === 'review') continue;
  if (d.name === 'villains') for (const v of fs.readdirSync(path.join(out, d.name))) voices.push('villains/' + v); else voices.push(d.name); }
for (const voice of voices) { if (only && voice !== only && !voice.startsWith(only + '/')) continue;
  const vdir = path.join(out, voice);
  for (const key of fs.readdirSync(vdir)) { const dir = path.join(vdir, key), mf = path.join(dir, 'meta.json'); if (!fs.existsSync(mf)) continue;
    const meta = JSON.parse(fs.readFileSync(mf, 'utf8'));
    const takes = fs.readdirSync(dir).map(f => /^take(\d+)\.mp3$/.exec(f)).filter(Boolean).map(m => +m[1]).sort((a, b) => a - b).map(n => {
      const norm = fs.existsSync(path.join(dir, `take${n}.norm.mp3`)); const rep = report[`${voice}/${key}/take${n}`] || {};
      return { n, src: `../${voice}/${key}/take${n}${norm ? '.norm' : ''}.mp3`, leveled: norm, flags: rep.flags || [], seconds: rep.seconds, heard: rep.heard, match: rep.match }; });
    lines.push({ voice, key, category: meta.category, text: meta.text, say: meta.say, aliases: meta.aliases || [], takes }); } }
lines.sort((a, b) => a.voice.localeCompare(b.voice) || String(a.category).localeCompare(String(b.category)) || a.text.localeCompare(b.text));

const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Momster clip review</title>
<style>
:root{--bg:#faf7ff;--card:#fff;--ink:#2d1a5c;--mut:#6b5a90;--line:#e3d9f7;--acc:#7a38cc;--warn:#b85c00;--good:#1a7f4b}
@media (prefers-color-scheme:dark){:root{--bg:#17102b;--card:#231a42;--ink:#f0e9ff;--mut:#b9a9de;--line:#3a2d63;--acc:#a98bf0;--warn:#ffb36b;--good:#6fdc9f}}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.4 system-ui,sans-serif}
header{position:sticky;top:0;z-index:5;background:var(--bg);border-bottom:1px solid var(--line);padding:10px 16px;display:flex;flex-wrap:wrap;gap:10px;align-items:center}
header h1{font-size:18px;margin:0 8px 0 0} select,input[type=search],button{font:inherit;padding:6px 10px;border-radius:8px;border:1px solid var(--line);background:var(--card);color:var(--ink)}
button.primary{background:var(--acc);color:#fff;border-color:var(--acc)} #count{color:var(--mut);margin-left:auto}
@media (max-width:600px){header{position:static}}
main{padding:12px 16px;max-width:900px;margin:0 auto} .line{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:12px;margin:10px 0}
.line.done{border-left:5px solid var(--good)} .line.redo{border-left:5px solid var(--warn)} .meta{color:var(--mut);font-size:13px} .txt{font-size:18px;margin:4px 0 8px}
.take{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin:6px 0;padding:6px 0;border-top:1px dashed var(--line)} .take audio{height:34px;max-width:100%}
.flag{background:var(--warn);color:#fff;border-radius:6px;padding:1px 7px;font-size:12px} .heard{color:var(--mut);font-size:13px;flex-basis:100%}
.ctl{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-top:8px} .ctl input[type=text]{flex:1;min-width:200px}
</style></head><body>
<header><h1>Momster clip review</h1>
<select id="voice"></select><select id="cat"></select>
<select id="show"><option value="all">All lines</option><option value="todo">Not decided yet</option><option value="flag">Flagged by the checks</option><option value="redo">Marked redo</option></select>
<input id="q" type="search" placeholder="search the text"><button class="primary" id="dl">Download decisions.json</button><span id="count"></span></header>
<main id="list"></main>
<script>
const LINES=${JSON.stringify(lines).replace(/</g, '\\u003c')};
const KEY='momsterReview:'+location.pathname; let D={}; try{ D=JSON.parse(localStorage.getItem(KEY)||'{}'); }catch(e){}
const save=()=>{ try{ localStorage.setItem(KEY,JSON.stringify(D)); }catch(e){} };
const id=l=>l.voice+'/'+l.key; const el=(t,a,c)=>{ const e=document.createElement(t); Object.entries(a||{}).forEach(([k,v])=>k==='class'?e.className=v:e.setAttribute(k,v)); (c||[]).forEach(x=>e.append(x)); return e; };
const vs=[...new Set(LINES.map(l=>l.voice))], cs=[...new Set(LINES.map(l=>l.category))];
voice.append(el('option',{value:''},['All voices']),...vs.map(v=>el('option',{value:v},[v]))); cat.append(el('option',{value:''},['All categories']),...cs.map(c=>el('option',{value:c},[c])));
function state(l){ const d=D[id(l)]||{}; return d.redo?'redo':(d.pick?'done':'todo'); }
function render(){
  const f={v:voice.value,c:cat.value,s:show.value,q:q.value.toLowerCase()}; list.innerHTML=''; let n=0;
  for(const l of LINES){ if(f.v&&l.voice!==f.v||f.c&&l.category!==f.c||f.q&&!l.text.toLowerCase().includes(f.q)) continue;
    const st=state(l); if(f.s==='todo'&&st!=='todo'||f.s==='redo'&&st!=='redo'||f.s==='flag'&&!l.takes.some(t=>t.flags.length)) continue; n++; if(n>300) continue;
    const d=D[id(l)]||{}; const box=el('div',{class:'line '+(st==='todo'?'':st)});
    box.append(el('div',{class:'meta'},[l.voice+' · '+l.category+' · '+l.key]), el('div',{class:'txt'},[l.text]));
    if(l.say&&l.say!==l.text) box.append(el('div',{class:'meta'},['sent as: '+l.say]));
    if(l.aliases&&l.aliases.length) box.append(el('div',{class:'meta'},['also used for '+l.aliases.length+' other line'+(l.aliases.length>1?'s':'')+' with the same words']));
    for(const t of l.takes){ const r=el('input',{type:'radio',name:id(l),value:t.n}); r.checked=String(d.pick)===String(t.n); r.onchange=()=>{ D[id(l)]=Object.assign(D[id(l)]||{},{pick:t.n,redo:false}); save(); render(); };
      const row=el('div',{class:'take'},[el('label',{},[r,' take '+t.n]),el('audio',{controls:'',preload:'none',src:t.src}),el('span',{class:'meta'},[(t.seconds?t.seconds+' s':'')+(t.leveled?'':' (not levelled)')]),...t.flags.map(x=>el('span',{class:'flag'},[x]))]);
      if(t.heard!==undefined) row.append(el('div',{class:'heard'},['heard: "'+t.heard+'" ('+Math.round((t.match||0)*100)+'% match)'])); box.append(row); }
    const none=el('input',{type:'checkbox'}); none.checked=!!d.redo; none.onchange=()=>{ D[id(l)]=Object.assign(D[id(l)]||{},{redo:none.checked}); if(none.checked) delete D[id(l)].pick; save(); render(); };
    const sp=el('input',{type:'text',placeholder:'say it like this (respelling)',value:d.respell||''}); sp.onchange=()=>{ D[id(l)]=Object.assign(D[id(l)]||{},{respell:sp.value.trim()}); if(!sp.value.trim()) delete D[id(l)].respell; save(); };
    box.append(el('div',{class:'ctl'},[el('label',{},[none,' redo this line']),sp])); list.append(box); }
  const total=LINES.length, done=LINES.filter(l=>state(l)==='done').length, redo=LINES.filter(l=>state(l)==='redo').length;
  count.textContent=done+' picked, '+redo+' redo, '+(total-done-redo)+' to go'+(n>300?' · showing 300 of '+n+', filter to see more':'');
}
[voice,cat,show].forEach(e=>e.onchange=render); q.oninput=render;
dl.onclick=()=>{ const a=el('a',{href:URL.createObjectURL(new Blob([JSON.stringify(D,null,1)],{type:'application/json'})),download:'decisions.json'}); document.body.append(a); a.click(); a.remove(); };
render();
</script></body></html>`;
fs.mkdirSync(path.join(out, 'review'), { recursive: true });
fs.writeFileSync(path.join(out, 'review', 'index.html'), html);
console.log(`review page for ${lines.length} lines (${lines.reduce((a, l) => a + l.takes.length, 0)} takes): ${path.relative(ROOT, path.join(out, 'review', 'index.html'))}`);
