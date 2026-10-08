/* Momster's tutorial: a narrated tour of the app. Loaded on demand by startTour() in index.html.
   Voice: audio/momster/tour_<n>.mp3 (always plays, whatever sound option the family picked).
   Art:   art/momster/<pose>.webp
   It uses the app's own globals (view, render, FIRST_KID, ...) and never writes kid data, except giveStarterCoins at the reward line. */
(function(){
"use strict";
if(window.MomsterTour) return;

const ART = {wave:"art/momster/wave.webp", stand:"art/momster/stand.webp", point:"art/momster/point.webp", thumbs:"art/momster/thumbs.webp", cheer:"art/momster/cheer.webp"};
const AUDIO = n => "audio/momster/tour_"+n+".mp3";
const BONUS = '.tab[data-r="bn"]', SIREN = {any:[".top .siren", ".top .hdTools"]}, TILE = ".tiles .tile", WHO = ".top .who", HQ = '.botnav [data-a="hq"]';

/* One entry per audio file. Each chunk is [startSeconds, caption, pose, highlight, view, action].
   Start times come from the pauses in the recordings. highlight is a selector (or a list: every match is
   lit together); no highlight means Momster talks on her own. view is "home" or "kid" and carries forward. */
const STEPS = [
 {dur:16.2, side:"L", intro:true, c:[
  [0,    "Hi! I’m Momster.", "wave"],
  [2.09, "I’m so glad you’re here to help me chase away the pesky villains hanging around our house.", "stand"],
  [7.62, "When a villain stays too long, I can get pretty grumpy.", "stand"],
  [11.63,"But with your help, I can get back to my happiest mood: relaxed!", "thumbs"]]},
 {dur:7.39, side:"R", intro:true, c:[
  [0,    "Before we begin, let me show you how it works.", "stand"],
  [3.34, "Listen closely, because I have an awesome reward for you at the end.", "cheer"]]},
 {dur:14.1, c:[
  [0,    "Each week, a different villain visits our house to cause chaos and spoil our fun.", "point", ".boss", "home"],
  [5.73, "Every villain has a health bar.", "point", ".mbar"],
  [7.93, "When that bar reaches zero, we win!", "cheer", ".mbar"],
  [10.72,"Every task you finish takes away some of the villain’s health.", "point", ".bface"]]},
 {dur:16.27, c:[
  [0,    "Some tasks and combos do extra damage.", "point", ".boss"],
  [3.37, "First, tap your card to open your profile.", "point", ".kidBtn"],
  [6.59, "Pick the prize you’d like to earn this week.", "point", ".prizePill", "kid"],
  [9.10, "Then you’ll see a Special Mission and a Surprise Mission.", "point", BONUS],
  [12.80,"You can choose your Special Mission now or come back to it later.", "stand", BONUS]]},
 {dur:15.57, c:[
  [0,    "Your tasks are sorted into five groups: Morning, After School, Bedtime, Helper, and Bonus.", "point", ".tabs"],
  [8.12, "Pick a group from the menu to see its tasks.", "point", ".tabs"],
  [10.98,"When you finish one, tap its card to see how much damage you did to the villain.", "point", TILE]]},
 {dur:12.67, c:[
  [0,    "See a siren in the top-right corner?", "point", SIREN],
  [2.54, "Tap it to check any Special or Surprise Missions you haven’t finished yet.", "point", SIREN],
  [6.88, "You can find them in Bonus, too.", "point", BONUS],
  [9.00, "They often do extra damage and come with extra rewards!", "cheer", BONUS]]},
 {dur:12.67, c:[
  [0,    "For helping me, you’ll earn stars and coins.", "thumbs", [".hdStars", ".hdCoin"]],
  [3.55, "Each task card shows how many stars you can earn.", "point", TILE],
  [6.86, "You also get your very own sidekick!", "cheer", WHO],
  [9.68, "You can dress it up and it wears the treasures you find.", "point", WHO]]},
 {dur:27.32, c:[
  [0,    "Collect stars to unlock stickers and badges in Hero HQ.", "point", HQ, "home"],
  [4.59, "When you reach the weekly star goal your family set, you’ll defeat the villain!", "thumbs", [".hdStars", ".hdBar"], "kid"],
  [9.32, "You’ll also get one coin each time you finish a task group, up to five coins a day.", "point", ".tabs"],
  [14.90,"If you complete all the tasks in a day, you can also hatch a mystery egg,", "point", ".tabs"],
  [19.76,"which awards you rare items for your sidekick or bonus coins!", "cheer", WHO],
  [23.87,"Defeat the weekly villain and you’ll get ten more coins.", "point", ".boss", "home"]]},
 {dur:16.67, c:[
  [0,    "And don’t stop there: until the next villain arrives, you’ll earn double coins for your tasks.", "cheer", ".hdCoin", "kid"],
  [6.26, "You can keep collecting stars for stickers, too.", "thumbs", ".hdStars"],
  [9.27, "Spend your coins on clothes, accessories, toys, pets, and backgrounds for your sidekick.", "point", ".hdCoin"],
  [15.41,"Make it yours!", "cheer", WHO]]},
 {dur:15.8, c:[
  [0,    "You listened all the way through, so here’s that awesome reward I promised:", "thumbs", ".hdCoin"],
  [4.99, "25 coins to get you started!", "cheer", ".hdCoin", "kid", "coins"],
  [7.56, "Spend them on something for your sidekick, or save them for later.", "point", WHO],
  [11.32,"Now, let’s pick your first task and show that villain what we can do!", "cheer", ".kidBtn", "home"]]}
];
// Fill in each chunk's view (it carries forward) and where its speech stops.
(function(){ let v="home"; STEPS.forEach(st=>{ st.c=st.c.map((c,j,all)=>{ v=c[4]||v; return {t:c[0], text:c[1], pose:c[2], sel:c[3]||null, v, act:c[5]||null, end:(j+1<all.length? all[j+1][0]-0.4 : st.dur)}; }); }); })();

const S = {on:false, i:0, j:-1, waiting:false, muted:false, useAudio:false, startedAt:0, raf:0, lastChange:0, prev:null, gen:0};
let root=null, el={};

function css(){
  if(document.getElementById("tourCss")) return;
  const s=document.createElement("style"); s.id="tourCss"; s.textContent=`
#tour{position:fixed;inset:0;z-index:99990;overflow:hidden;-webkit-tap-highlight-color:transparent;cursor:pointer;user-select:none;-webkit-user-select:none}
#tour .tdim{position:absolute;inset:0;background:rgba(14,10,38,.8);backdrop-filter:blur(3px);-webkit-backdrop-filter:blur(3px);opacity:0;transition:opacity .45s;pointer-events:none}
#tour.tintro .tdim{opacity:1}
#tour .thole{position:absolute;border-radius:22px;pointer-events:none;opacity:0;transition:top .45s,left .45s,width .45s,height .45s,opacity .3s;
  box-shadow:0 0 0 4px #FFD84D,0 0 22px 8px rgba(255,216,77,.75),0 0 0 200vmax rgba(14,10,38,.74);animation:tourPulse 1.4s ease-in-out infinite}
#tour.tlit .thole{opacity:1}
@keyframes tourPulse{50%{box-shadow:0 0 0 6px #FFD84D,0 0 34px 14px rgba(255,216,77,.95),0 0 0 200vmax rgba(14,10,38,.74)}}
#tour .tmw{position:absolute;transition:left .7s cubic-bezier(.3,1.15,.4,1),top .45s,bottom .45s,height .45s;pointer-events:none}
#tour .tmo{display:block;height:100%;width:auto;filter:drop-shadow(0 6px 10px rgba(0,0,0,.45));transform-origin:50% 100%}
#tour .tmo.flip{transform:scaleX(-1)}
#tour .tmo.pop{animation:tourPop .5s ease-out}
#tour .tmo.hop{animation:tourHop .6s ease-in-out 3}
@keyframes tourPop{0%{transform:scale(.9) translateY(6px)}60%{transform:scale(1.05)}100%{transform:none}}
@keyframes tourHop{50%{transform:translateY(-4%)}}
#tour .tmo.flip.pop{animation-name:tourPopF}
#tour .tmo.flip.hop{animation-name:tourHopF}
@keyframes tourPopF{0%{transform:scaleX(-1) scale(.9) translateY(6px)}60%{transform:scaleX(-1) scale(1.05)}100%{transform:scaleX(-1)}}
@keyframes tourHopF{50%{transform:scaleX(-1) translateY(-4%)}}
#tour .tbub{position:absolute;background:#fff;color:#2D1A5C;border:4px solid #7A38CC;border-radius:26px;padding:12px 16px 10px;box-shadow:0 10px 30px rgba(0,0,0,.4);
  transition:left .5s,right .5s,top .4s,bottom .4s;cursor:default;display:flex;flex-direction:column;gap:8px}
#tour .tcap{margin:0;font-size:clamp(17px,4.7vw,24px);line-height:1.3;font-weight:700;min-height:2.6em;display:flex;align-items:center}
#tour .tcap span{display:block}
#tour .tcap .w{opacity:.14;transition:opacity .15s}
#tour .tcap .w.on{opacity:1}
#tour.tintro .tcap{font-size:clamp(21px,6vw,34px);text-align:center;justify-content:center}
#tour .trow{display:flex;gap:6px;align-items:center}
#tour .trow button{font:inherit;font-weight:800;font-size:15px;min-height:42px;min-width:42px;border-radius:999px;border:2px solid #7A38CC;background:#F2EAFF;color:#4B2A8F;padding:0 8px;cursor:pointer;white-space:nowrap}
#tour .trow .tnext{flex:1;background:#7A38CC;color:#fff}
#tour .trow .tnext.nudge{animation:tourNudge 1s ease-in-out infinite;background:#FF7A1A;border-color:#E2560C}
#tour .trow .tskip{background:transparent;border-color:transparent;color:#6b5a90;padding:0 8px;font-size:14px}
@keyframes tourNudge{50%{transform:scale(1.05)}}
#tour .tflash{position:absolute;pointer-events:none;font-size:34px;font-weight:900;color:#FFD84D;text-shadow:0 3px 0 #7A38CC,0 0 12px rgba(0,0,0,.6);animation:tourFly 1.6s ease-out forwards}
@keyframes tourFly{from{transform:translateY(0) scale(.6);opacity:0}15%{opacity:1;transform:translateY(-10px) scale(1.2)}to{transform:translateY(-80px) scale(1);opacity:0}}
@media (prefers-reduced-motion:reduce){#tour .tmo.hop,#tour .thole,#tour .tnext.nudge{animation:none}#tour .tmw,#tour .tbub{transition:none}}
`;
  document.head.appendChild(s);
}

function build(){
  css();
  root=document.createElement("div"); root.id="tour"; root.setAttribute("role","dialog"); root.setAttribute("aria-label","Momster's tutorial");
  root.innerHTML='<div class="tdim"></div><div class="thole"></div><div class="tmw"><img class="tmo" alt="Momster"></div>'+
    '<div class="tbub"><p class="tcap" aria-live="polite"></p><div class="trow"><button class="tback" aria-label="Back">◀</button><button class="tnext">Next ▶</button><button class="tmute" aria-label="Mute Momster">🔊</button><button class="tskip">Skip</button></div></div>';
  document.body.appendChild(root);
  el={dim:root.querySelector(".tdim"), hole:root.querySelector(".thole"), mw:root.querySelector(".tmw"), mo:root.querySelector(".tmo"), bub:root.querySelector(".tbub"), cap:root.querySelector(".tcap"), next:root.querySelector(".tnext"), mute:root.querySelector(".tmute")};
  root.addEventListener("click", e=>{
    const b=e.target.closest("button");
    if(b){ e.stopPropagation(); if(b.classList.contains("tback")) back(); else if(b.classList.contains("tskip")) finish(false); else if(b.classList.contains("tmute")) toggleMute(); else next(); return; }
    next();
  });
  root.addEventListener("pointerdown", e=>{ e.stopPropagation(); }, true);
  window.addEventListener("resize", relayout);
  window.addEventListener("orientationchange", relayout);
  try{ S.mo=new MutationObserver(()=>{ if(S.on && !S.moOff) { clearTimeout(S.moT); S.moT=setTimeout(relayout,60); } }); S.mo.observe(document.getElementById("app"),{childList:true,subtree:true}); }catch(e){}
  document.addEventListener("keydown", onKey, true);
}

function onKey(e){ if(!S.on) return; if(e.key==="Escape"){ e.preventDefault(); finish(false); } else if(e.key==="ArrowRight"||e.key===" "||e.key==="Enter"){ e.preventDefault(); next(); } else if(e.key==="ArrowLeft"){ e.preventDefault(); back(); } }

/* ---------- which screen is behind the tour ---------- */
function routineFor(k){ const dow=todayDow(); const cur=ROUTINES.find(r=>r.id===view.routine); if(cur && cur.id && jobsFor(cur,dow,k).length) return cur.id;
  const r=ROUTINES.find(x=>jobsFor(x,dow,k).length); return r ? r.id : defaultRoutine(); }
function setView(v){
  const want = v==="kid" ? FIRST_KID : null;
  if(view.kid===want && (!want || view.routine===routineFor(want))) return false;
  S.moOff=true; view.kid=want; if(want) view.routine=routineFor(want);
  try{ render(); }catch(e){ console.warn(e); }
  S.moOff=false; return true;
}

/* ---------- spotlight + Momster placement ---------- */
function visible(e){ return !!e && (e.offsetParent!==null || getComputedStyle(e).position==="fixed"); }
function targetRect(sel){
  if(!sel) return null;
  // {any:[...]} lights the first one that is on screen; a plain list lights every match together.
  const list = sel.any ? sel.any : (Array.isArray(sel) ? sel : [sel]);
  let r=null;
  for(const q of list){ const e=document.querySelector(q); if(!visible(e)) continue;
    try{ e.scrollIntoView({block:"nearest",inline:"nearest"}); }catch(_){}
    const b=e.getBoundingClientRect(); if(!b.width||!b.height) continue;
    r = r ? {left:Math.min(r.left,b.left), top:Math.min(r.top,b.top), right:Math.max(r.right,b.right), bottom:Math.max(r.bottom,b.bottom)} : {left:b.left, top:b.top, right:b.right, bottom:b.bottom};
    if(sel.any) break; }
  return r ? pad(r) : null;
}
function pad(b){ const p=8; return {left:Math.max(4,b.left-p), top:Math.max(4,b.top-p), right:Math.min(innerWidth-4,b.right+p), bottom:Math.min(innerHeight-4,b.bottom+p)}; }

function layout(c){
  const st=STEPS[S.i], W=innerWidth, H=innerHeight, land=W>H;
  const intro=!!st.intro && !c.sel;
  root.classList.toggle("tintro", intro);
  const rect = intro ? null : targetRect(c.sel);
  root.classList.toggle("tlit", !!rect);
  if(rect){ Object.assign(el.hole.style,{left:rect.left+"px", top:rect.top+"px", width:(rect.right-rect.left)+"px", height:(rect.bottom-rect.top)+"px"}); }
  const ratio=.665;
  const mh = intro ? Math.min(land? H*.5 : H*.55, 520) : Math.min(land? H*.42 : H*.25, 230);
  const mw = mh*ratio;
  // left or right: opposite the thing she is pointing at, so her hand points inward
  let side = st.side || "L";
  if(rect){ const cx=(rect.left+rect.right)/2; side = cx>W/2 ? "L" : "R"; }
  S.side=side;
  el.mo.classList.toggle("flip", side==="R");
  el.mw.style.height=mh+"px"; el.mw.style.width=mw+"px";
  el.mw.style.left = (side==="L" ? 8 : W-mw-8)+"px";
  const gap=10, bubW = intro ? Math.min(W-24, 640) : W - mw*.78 - 8 - gap - 8;
  const place=(pos)=>{
    if(intro){ el.mw.style.top="auto"; el.mw.style.bottom="0px"; el.bub.style.bottom="auto"; el.bub.style.top="calc(env(safe-area-inset-top,0px) + "+Math.max(10,H*.04)+"px)"; el.bub.style.left=((W-bubW)/2)+"px"; el.bub.style.right="auto"; el.bub.style.width=bubW+"px"; return; }
    el.mw.style.top = pos==="top" ? "calc(env(safe-area-inset-top,0px) + 8px)" : "auto"; el.mw.style.bottom = pos==="top" ? "auto" : "8px";
    el.bub.style.top = pos==="top" ? "calc(env(safe-area-inset-top,0px) + 8px)" : "auto"; el.bub.style.bottom = pos==="top" ? "auto" : "8px";
    el.bub.style.width=bubW+"px"; el.bub.style.right="auto";
    el.bub.style.left = (side==="L" ? 8+mw*.78+gap : 8)+"px";
  };
  let pos="bottom"; place(pos);
  if(rect){
    const over=()=>{ const b=el.bub.getBoundingClientRect(), m=el.mw.getBoundingClientRect(), u={top:Math.min(b.top,m.top), bottom:Math.max(b.bottom,m.bottom)}; return Math.max(0, Math.min(u.bottom,rect.bottom)-Math.max(u.top,rect.top)); };
    const o1=over(); if(o1>0){ pos="top"; place(pos); const o2=over(); if(o2>o1){ pos="bottom"; place(pos); } }
  }
  S.pos=pos;
}
function relayout(){ if(S.on && S.j>=0) layout(STEPS[S.i].c[S.j]); }

/* ---------- captions ---------- */
function setCaption(c){
  const words=c.text.split(" "); el.cap.innerHTML="<span>"+words.map(w=>'<i class="w" style="font-style:normal">'+w.replace(/&/g,"&amp;").replace(/</g,"&lt;")+"</i>").join(" ")+"</span>";
  S.words=[...el.cap.querySelectorAll(".w")]; const tot=words.reduce((a,w)=>a+w.length+2,0); let acc=0; S.cum=words.map(w=>{ const s=acc/tot; acc+=w.length+2; return s; });
}
function reveal(c,t,all){ const dur=Math.max(.3,c.end-c.t); const f=all?1.01:Math.min(1.01,(t-c.t)/dur*1.04); S.words.forEach((w,i)=>w.classList.toggle("on", f>=S.cum[i])); }

/* ---------- audio ---------- */
function stopAudio(){ try{ player.pause(); }catch(e){} player.onplaying=null; player.onended=null; player.onerror=null; }
// Clips are fetched whole and played from a blob URL, so seeking always works (a service-worker response can't be seeked) and the next clip is ready before it is needed.
const BLOBS={};
function blobFor(n){ if(n>STEPS.length) return Promise.resolve(null); return BLOBS[n] || (BLOBS[n]=fetch(AUDIO(n)).then(r=>{ if(!r.ok) throw new Error("missing"); return r.blob(); }).then(b=>URL.createObjectURL(b)).catch(()=>null)); }
function playStep(i, from){
  const gen=++S.gen; stopAudio(); queue=[]; S.useAudio=false; S.waiting=false; S.ended=false; S.startedAt=performance.now()-(from||0)*1000;
  player.muted=S.muted; player.volume = soundLevel===0 ? 1 : soundLevel;
  blobFor(i+2);
  blobFor(i+1).then(u=>{
    if(gen!==S.gen||!S.on) return;
    player.onloadedmetadata=()=>{ if(from>0){ try{ player.currentTime=from; }catch(e){} } };
    player.onplaying=()=>{ if(gen===S.gen) S.useAudio=true; };
    player.onended=()=>{ if(gen===S.gen){ S.useAudio=false; S.ended=true; } };
    player.onerror=()=>{ if(gen===S.gen) S.useAudio=false; };
    player.src=u||AUDIO(i+1);
    const p=player.play(); if(p&&p.catch) p.catch(()=>{ if(gen===S.gen) S.useAudio=false; });
  });
}
function toggleMute(){ S.muted=!S.muted; player.muted=S.muted; el.mute.textContent=S.muted?"🔇":"🔊"; }

/* ---------- running the tour ---------- */
function goStep(i, from){
  S.i=i; S.j=-1; S.ended=false; S.lastChange=performance.now();
  playStep(i, from||0);
  cancelAnimationFrame(S.raf); S.raf=requestAnimationFrame(tick);
}
function clock(){ return S.useAudio ? player.currentTime : (performance.now()-S.startedAt)/1000; }
function chunkAt(st,t){ let j=0; for(let k=0;k<st.c.length;k++){ if(st.c[k].t<=t+.02) j=k; } return j; }

function tick(){
  if(!S.on) return;
  const st=STEPS[S.i]; let t=clock();
  if(S.ended || t>=st.dur+.15){ if(!S.waiting){ S.waiting=true; S.j=S.j<0?0:S.j; const c=st.c[st.c.length-1]; if(S.j!==st.c.length-1) showChunk(st.c.length-1); reveal(c,st.dur,true); updateNext(); } }
  else {
    const j=chunkAt(st,t); if(j!==S.j) showChunk(j);
    reveal(st.c[S.j], t, false);
  }
  S.raf=requestAnimationFrame(tick);
}

function showChunk(j){
  const st=STEPS[S.i], c=st.c[j]; S.j=j; S.lastChange=performance.now();
  const changed=setView(c.v);
  setCaption(c);
  const apply=()=>{ if(!S.on||S.j!==j) return; layout(c); setPose(c.pose); };
  if(changed){ requestAnimationFrame(()=>requestAnimationFrame(apply)); } else apply();
  setTimeout(()=>{ if(S.on&&S.j===j) layout(c); },350);   // once the screen behind has settled
  if(c.act==="coins") reward();
  updateNext();
}
function setPose(p){ if(S.pose===p && el.mo.getAttribute("src")) return; S.pose=p; el.mo.src=ART[p]; el.mo.classList.remove("pop","hop"); void el.mo.offsetWidth; el.mo.classList.add(p==="cheer"?"hop":"pop"); }
function updateNext(){
  const last = S.i===STEPS.length-1;
  el.next.textContent = S.waiting ? (last ? "Let’s go! 🎉" : "Next ▶") : "Next ▶";
  el.next.classList.toggle("nudge", !!S.waiting);
}

function next(){
  if(!S.on || performance.now()-S.lastChange<450) return;
  const st=STEPS[S.i];
  if(S.waiting){ if(S.i>=STEPS.length-1) return finish(true); return goStep(S.i+1,0); }
  // mid-clip: jump to the next caption (or the end of the clip)
  const nj=S.j+1;
  if(nj<st.c.length){ const at=st.c[nj].t; if(S.useAudio){ try{ player.currentTime=at; }catch(e){} } else S.startedAt=performance.now()-at*1000; }
  else { if(S.i>=STEPS.length-1){ S.ended=true; } else goStep(S.i+1,0); }
}
function back(){
  if(!S.on) return;
  const t=clock();
  if(t>2 || S.i===0) return goStep(S.i,0);
  goStep(S.i-1,0);
}

/* The reward line: 25 coins for every kid (once; giveStarterCoins remembers it). */
function reward(){
  if(S.rewarded) return; S.rewarded=true;
  try{ KID_IDS.forEach(k=>{ if(buddies[k]) giveStarterCoins(k); }); }catch(e){ console.warn(e); }
  S.moOff=true; try{ render(); }catch(e){} S.moOff=false;
  setTimeout(()=>{ if(!S.on) return; relayout();
    try{ party(["🪙","⭐","🎉","🪙"]); const p=[...document.querySelectorAll(".party")].pop(); if(p) p.style.zIndex=99995; }catch(e){}
    const e=document.querySelector(".hdCoin"); if(e){ const b=e.getBoundingClientRect(), f=document.createElement("div"); f.className="tflash"; f.textContent="+"+STARTER_COINS+" 🪙"; f.style.left=Math.max(8,b.left)+"px"; f.style.top=(b.bottom+4)+"px"; root.appendChild(f); setTimeout(()=>f.remove(),1700); }
    try{ if(soundLevel>0){ const u=getUrl("sfx","fanfare"); if(u){ const a=new Audio(u); a.volume=Math.min(.5,soundLevel); a.play().catch(()=>{}); } } }catch(e){}
  }, 120);
}

function finish(completed){
  if(!S.on) return;
  S.on=false; window.tourOn=false; cancelAnimationFrame(S.raf); S.gen++; stopAudio(); player.muted=false;
  Object.keys(BLOBS).forEach(n=>{ BLOBS[n].then(u=>{ if(u) URL.revokeObjectURL(u); }); delete BLOBS[n]; });
  try{ S.mo&&S.mo.disconnect(); }catch(e){}
  window.removeEventListener("resize", relayout); window.removeEventListener("orientationchange", relayout); document.removeEventListener("keydown", onKey, true);
  if(root){ root.remove(); root=null; }
  view.kid=null; view.routine=S.prev ? S.prev.routine : defaultRoutine();
  try{ render(); }catch(e){ console.warn(e); }
  const opts=S.opts||{}; if(typeof opts.done==="function"){ try{ opts.done(!!completed); }catch(e){} }
}

function start(opts){
  if(S.on) return;
  opts=opts||{}; S.opts=opts; S.rewarded=false; S.muted=false; S.pose=null; S.ended=false;
  S.prev={kid:view.kid, routine:view.routine};
  try{ close(); }catch(e){}
  S.on=true; window.tourOn=true;
  build();
  Object.keys(ART).forEach(k=>{ const im=new Image(); im.src=ART[k]; });
  goStep(0,0);
}

window.MomsterTour = {start, finish, steps:STEPS, state:S, next, back, goTo:goStep, reward};
})();
