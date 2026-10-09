// Audio coverage: every line the app can speak must have a row in audio/lines.csv (and therefore a clip to generate).
// A clip is named after its exact text, so a line that is missing here is silent in the app and an edited line orphans its clip.
//   * Spoken lines: collected by running the app's own data tables and flows in a real browser (jobs, prizes, missions, villain
//     taunts and moods, jokes, combos, ranks, shop items, intro texts...) plus every literal "BJ:" line in the source.
//   * Kid-name sentences are reported by template (they are generated per name, not listed in the CSV).
//   * Known dynamic lines (they contain a number or a name that changes) cannot be recorded one by one; they are listed, not failed.
//   * On-screen text with no matching line is reported (non-failing) for the tap-to-hear work.
// Usage: node tests/audio-coverage.test.js   (AUDIO_REPORT=1 prints every gap; CHROME env var overrides the browser path)
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");
const http = require("http");

const CHROME = process.env.CHROME
  || ["/snap/bin/chromium","/usr/bin/chromium","/usr/bin/chromium-browser","/usr/bin/google-chrome","/usr/bin/google-chrome-stable",
      "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe","C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe"]
     .find(p => p && fs.existsSync(p));
const REPO = path.resolve(__dirname, "..");
const CDP_PORT = 19514, HTTP_PORT = 19515;
const sleep = ms => new Promise(r => setTimeout(r, ms));

function startServer(){
  const types = { ".html":"text/html", ".js":"application/javascript", ".json":"application/json", ".png":"image/png", ".svg":"image/svg+xml", ".mp3":"audio/mpeg", ".webp":"image/webp" };
  const svr = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split("?")[0]); if(p === "/") p = "/index.html";
    const file = path.join(REPO, p);
    if(!file.startsWith(REPO) || !fs.existsSync(file)){ res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": types[path.extname(file)] || "application/octet-stream" });
    res.end(fs.readFileSync(file));
  });
  return new Promise(resolve => svr.listen(HTTP_PORT, "127.0.0.1", () => resolve(svr)));
}

async function run(){
  if(!CHROME){ console.log("NO BROWSER"); process.exit(2); }
  const server = await startServer();
  const URL_ = "http://127.0.0.1:"+HTTP_PORT+"/index.html";
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mh-cov-"));
  const proc = spawn(CHROME, ["--headless=new","--remote-debugging-port="+CDP_PORT,"--user-data-dir="+dir,
    "--no-first-run","--disable-gpu","--no-default-browser-check","--disable-extensions","--mute-audio","about:blank"], { stdio:"ignore" });
  let targets = null;
  for(let i=0;i<60;i++){
    try { targets = await (await fetch("http://127.0.0.1:"+CDP_PORT+"/json")).json(); if(targets.find(t=>t.type==="page")) break; }catch(e){}
    await sleep(200);
  }
  if(!targets || !targets.find(t=>t.type==="page")){ console.log("NO CDP"); proc.kill(); server.close(); process.exit(2); }
  const ws = new WebSocket(targets.find(t=>t.type==="page").webSocketDebuggerUrl);
  await new Promise(r => ws.onopen = r);
  let id = 0; const pend = {};
  ws.onmessage = m => { const d = JSON.parse(m.data); if(d.id && pend[d.id]){ pend[d.id](d); delete pend[d.id]; } };
  const send = (method, params={}) => new Promise(r => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({id:i,method,params})); });
  let fails = 0;
  const ev = async expr => { const r = await send("Runtime.evaluate",{expression:expr,awaitPromise:true,returnByValue:true});
    if(r.result && r.result.exceptionDetails){ fails++; console.log("FAIL script error in: "+expr.replace(/\s+/g," ").slice(0,110)+" -> "+((r.result.exceptionDetails.exception||{}).description||"").split("\n")[0]); return null; }
    return r.result && r.result.result ? r.result.result.value : null; };
  const ok = (cond, msg) => { console.log((cond ? "PASS " : "FAIL ") + msg); if(!cond) fails++; };
  const canon = x => JSON.stringify(x, (k,v) => v && typeof v === "object" && !Array.isArray(v) ? Object.keys(v).sort().reduce((o,kk) => (o[kk]=v[kk], o), {}) : v);
  const same = (a, b) => canon(a) === canon(b);



  const parseCsv = t => { const rows=[]; let row=[], cur="", q=false; for(let i=0;i<t.length;i++){ const c=t[i];
    if(q){ if(c==='"'&&t[i+1]==='"'){ cur+='"'; i++; } else if(c==='"') q=false; else cur+=c; }
    else if(c==='"') q=true; else if(c===","){ row.push(cur); cur=""; } else if(c==="\n"){ row.push(cur); rows.push(row); row=[]; cur=""; } else if(c!=="\r") cur+=c; } return rows; };
  const [csvHead, ...csvRows] = parseCsv(fs.readFileSync(path.join(REPO,"audio/lines.csv"),"utf8"));
  const csvKeys = new Set(csvRows.map(r=>r[0]).filter(Boolean));
  const norm = s => String(s).toLowerCase().replace(/[^a-z0-9 ]+/g," ").replace(/\s+/g," ").trim();
  const csvTexts = new Set(csvRows.map(r=>norm(r[3]||"")).filter(Boolean));
  const srcAll = fs.readFileSync(path.join(REPO,"index.html"),"utf8") + "\n" + fs.readFileSync(path.join(REPO,"tour.js"),"utf8");

  async function ready(){
    for(let i=0;i<40;i++){ if(await ev(`typeof DEFAULT_FAMILY === "object" && typeof textKey === "function" && typeof ITEMS === "object"`)) return; await sleep(250); }
    throw new Error("app did not initialize");
  }
  try {
    await send("Page.navigate", { url: URL_ }); await ready();
    await ev(`localStorage.clear(); localStorage.setItem("starjobs_family", JSON.stringify(DEFAULT_FAMILY)); saveLocal("settings",{pin:"1234",goal:80,setupDone:true,avatars:{}}); saveLocal("intro_"+WEEK, 1); saveLocal("readMode","nonreaders"); saveLocal("voiceLvl",1); saveLocal("vol",1); true`);
    await send("Page.navigate", { url: URL_ }); await ready();

    // ---- 1. every line the app can ask to hear, built from the app's own data ----
    const found = await ev(`(function(){
      const E=[]; const add=(src,k)=>{ if(k) E.push({src,raw:k}); };
      const BJ=t=>"BJ:"+t, k0=FIRST_KID;
      ROUTINES.forEach(r=>{ add("routine name "+r.id, r.snd); add("routine done "+r.id, r.doneSnd||"alldone");
        [0,1,2,3,4,5,6].forEach(d=>KID_IDS.forEach(k=>jobsFor(r,d,k).forEach(j=>add("job "+r.id, j.snd)))); });
      (typeof HELPER_LIST!=="undefined"?HELPER_LIST:[]).forEach(j=>add("helper job", j.snd));
      try{ bonusJobs().forEach(j=>add("bonus job", j.snd || BJ(j.t))); }catch(e){}
      REWARDS.forEach(r=>add("prize", r.snd));
      Object.values(BONUS_JOBS_POOL).flat().forEach(j=>add("optional job (setup pool)", BJ(j.t+".")));
      pickList().forEach(p=>{ add("special mission", BJ("Your special mission: "+p.t+".")); add("special mission name", BJ(p.t+".")); });
      add("special mission", BJ("Pick your special mission for today."));
      EVENTS.forEach(e=>{ add("surprise mission", BJ("Surprise mission! "+e[2]+". "+e[3]+".")); add("surprise mission announce", BJ("Emergency! "+e[2]+" "+e[3]+"!")); });
      for(let n=1;n<=9;n++) add("silly twist","s"+n); TWISTS.slice(9).forEach(t=>add("silly twist",BJ("Do it "+t+"!")));
      Object.values(TAUNTS).flat().forEach(t=>add("villain taunt",BJ(t))); Object.values(VJOKES).flat().forEach(t=>add("villain joke",BJ(t)));
      MOODS.forEach(m=>m[1].forEach(t=>add("villain mood",BJ(t)))); KO_LINES.forEach(t=>add("villain defeated",BJ(t)));
      add("villain line",BJ("Grrr! Mess forever!"));
      MONSTERS.forEach(m=>{ add("villain name", m[0]); add("villain intro", BJ(villainIntroText(m))); });
      N_LINES.forEach(t=>add("cheer",BJ(t))); JOKES.forEach(j=>{ add("joke of the day setup",BJ(j[0])); add("joke of the day punchline",BJ(j[1])); });
      for(let i=1;i<=17;i++) add("joke","k"+i); for(let i=1;i<=8;i++) add("joke","hk"+i); for(let i=1;i<=12;i++) add("cheer","c"+i);
      for(let i=1;i<=3;i++) add("already done","a"+i); ["pow1","pow2","pow3","pow4"].forEach(x=>add("battle pop",x)); for(let i=1;i<=5;i++) add("jobs left","more"+i);
      Object.values(COMBO_NAMES).forEach(c=>add("combo",BJ("Combo attack! "+c[1]+"!")));
      RANKS.slice(0,6).forEach(r=>add("level up",BJ("Level up! You are now "+r[2]+"!")));
      ITEMS.forEach(it=>add("shop item",BJ(it[3])));
      ["Walking today!","Bus today!","Driving today!"].forEach(t=>add("ride picker",BJ(t)));
      ["momster_cheer","momster_almost","momster_win"].forEach(x=>add("Momster line",x));
      return E.map(e=>{ const r=e.raw; return {src:e.src, raw:r, id: r.startsWith("BJ:") ? textKey(r.slice(3)) : r, text: r.startsWith("BJ:") ? r.slice(3) : null}; }); })()`);
    // plain keys that are sound effects, not spoken lines
    const sfx = new Set(await ev(`Object.keys(CLIPS.sfx).concat([...SFX])`));
    // ---- 1b. the same question asked of the running app: drive real flows with the speaker stubbed out and record every request ----
    const traced = await ev(`(async function(){
      const REQ=[]; const realPlay=play; window.play=function(keys){ (keys||[]).forEach(k=>{ if(k) REQ.push(k); }); };
      const sleep=ms=>new Promise(r=>setTimeout(r,ms)); const errs=[];
      const act=(a,ds)=>{ const b=document.createElement("button"); b.dataset.a=a; Object.entries(ds||{}).forEach(([k,v])=>b.dataset[k]=v); document.body.appendChild(b); try{ b.click(); }catch(e){ errs.push(a+": "+e.message); } b.remove(); };
      const run=async(n,f)=>{ try{ await f(); }catch(e){ errs.push(n+": "+e.message); } await sleep(40); };
      // every job in every group, tapped for real
      for(const r of ROUTINES){ await run("jobs "+r.id,async()=>{ view.kid="k1"; view.routine=r.id; layer.innerHTML=""; render();
        for(const j of jobsFor(r,todayDow(),"k1")){ tapJob("k1", j.id); await sleep(20); } layer.innerHTML=""; }); }
      await run("routine tabs",async()=>{ for(const r of ROUTINES.map(x=>x.id).concat(["bn"])){ act("routine",{r}); await sleep(20); } });
      await run("open a kid",async()=>{ view.kid=null; render(); act("kid",{k:"k1"}); act("kid",{k:"k2"}); });
      await run("villain pokes",async()=>{ view.kid=null; render(); const el=document.querySelector('[data-a="bossTap"]'); for(let i=0;i<16;i++) bossTap(el); });
      await run("toots",async()=>{ view.kid=null; render(); const el=document.createElement("button"); document.body.appendChild(el); for(let i=0;i<14;i++) tootAttack(el); el.remove(); });
      await run("silly taps",async()=>{ const el=document.createElement("div"); document.body.appendChild(el); for(let i=0;i<30;i++) sideSilly(el); el.remove(); });
      await run("combos",async()=>{ ROUTINES.forEach(r=>comboFx(r)); });
      await run("damage card",async()=>{ dmgPopNow(7); document.querySelectorAll(".dmgpop-ov").forEach(x=>x.remove()); });
      await run("sheets",async()=>{ for(const a of ["jokeSheet","jodAnswer","jodReplay","test","joke","hq","sound","eggDummy"]) act(a,{k:"k1"}); });
      await run("shop",async()=>{ view.kid="k1"; render(); act("buddy",{k:"k1"}); buddies.k1.adjCoins=0; for(const it of ITEMS){ act("bItem",{v:it[1]}); } });
      await run("eggs",async()=>{ view.kid="k1"; act("egg",{}); for(let i=0;i<3;i++) act("eggTap",{}); });
      await run("prizes",async()=>{ view.kid="k1"; render(); REWARDS.forEach(r=>{ rewardSheet("k1"); act("rw",{r:r.id}); }); layer.innerHTML=""; });
      await run("missions",async()=>{ for(const e of EVENTS){ settings.event={id:e[0],e:e[1],title:e[2],t:e[3],pts:e[4],day:ymd(new Date())}; Object.keys(localStorage).filter(k=>k.indexOf("mpop_")>=0).forEach(k=>localStorage.removeItem(k)); view.kid="k1"; missionPopupOpen=false; layer.innerHTML=""; missionPopup("k1"); } layer.innerHTML=""; });
      await run("rank",async()=>{ RANKS.forEach((r,i)=>{ saveLocal("rankSeen",i-1); try{ checkRank(); }catch(e){} }); });
      await run("village intro",async()=>{ view.kid=null; render(); villainIntro(); layer.innerHTML=""; });
      await sleep(5200);
      window.play=realPlay; layer.innerHTML=""; document.querySelectorAll(".cheer,.dmgpop-ov,.party").forEach(x=>x.remove());
      return {req:REQ.map(k=>({raw:k,id:k.indexOf("BJ:")===0?textKey(k.slice(3)):k,text:k.indexOf("BJ:")===0?k.slice(3):null})), errs};
    })()`);
    ok(traced && traced.req.length > 100, "the traced run asked for "+(traced?traced.req.length:0)+" clips ("+(traced&&traced.errs.length?traced.errs.length+" scenario errors: "+traced.errs.slice(0,3).join("; "):"no scenario errors")+")");
    const tracedMissing = new Map(), nameTpl = new Set();
    for(const r of (traced?traced.req:[])){
      if(r.raw.startsWith("N:")){ nameTpl.add(r.raw.split(":")[1]); continue; }
      if(!r.text && sfx.has(r.raw)) continue;
      if(/more to go!$|^Minus |^Every chore you finish/.test(r.text||"")) continue;
      if(csvKeys.has(r.id)) continue;
      if(!tracedMissing.has(r.id)) tracedMissing.set(r.id, r.text||r.raw);
    }
    if(tracedMissing.size){ console.log("  asked for while running but not in lines.csv:"); [...tracedMissing.values()].slice(0,40).forEach(t=>console.log("    - "+t)); }
    ok(tracedMissing.size === 0, "every clip the running app asked for is in lines.csv ("+tracedMissing.size+" missing)");
    console.log("INFO name templates the app asked for while running: "+[...nameTpl].sort().join(", "));

    // plain keys that are sound effects, not spoken lines
    // literal lines in the source: "BJ:Some text" not followed by +
    const lit = []; for(const m of srcAll.matchAll(/"BJ:([^"\n]+)"(\s*[+])?/g)){ if(!m[2]) lit.push(m[1]); }
    const litKeys = JSON.parse(await ev(`JSON.stringify(${JSON.stringify([...new Set(lit)])}.map(t=>({src:"literal in source",raw:"BJ:"+t,id:textKey(t),text:t})))`));
    // toot reactions are a list inside tootAttack()
    const L = (srcAll.match(/const L=\[([^\]]*)\]/)||["",""])[1].match(/"[^"]+"/g)||[]; const tootLines = L.map(s=>s.slice(1,-1)).filter(t=>!/blame/i.test(t));
    const tootKeys = JSON.parse(await ev(`JSON.stringify(${JSON.stringify([...new Set(tootLines)])}.map(t=>({src:"toot reaction",raw:"BJ:"+t,id:textKey(t),text:t})))`));
    const all = found.concat(litKeys, tootKeys);

    // lines that contain a changing number or name: recorded another way, listed here on purpose
    const DYNAMIC = [
      "Damage card: \"Minus N health! <villain> has N health left!\" (numbers up to the villain's health)",
      "\"N more to go!\" when more than five jobs are left",
      "Cheer banners with live numbers: \"N family toots!\" and the toot milestone sentences (shown only, no sound)",
      "A family's own text: custom jobs, prizes and special missions (generated per family, or silent)",
      "Kid-name sentences: hi, justme, blame, ready_hero/princess/knight/ninja (generated per name)"
    ];
    const dynamicIds = a => /^BJ:(\d+ more to go!|Minus |Every chore you finish)/.test(a.raw) || /\d/.test(a.raw) && /more to go|health left/.test(a.raw);
    const missing = new Map();
    for(const a of all){ if(dynamicIds(a)) continue; if(!a.text && sfx.has(a.raw)) continue; if(csvKeys.has(a.id)) continue; if(!missing.has(a.id)) missing.set(a.id, a); }
    const total = new Set(all.filter(a=>a.text||!sfx.has(a.raw)).map(a=>a.id)).size;
    console.log("INFO "+total+" distinct lines the app can speak; "+csvKeys.size+" rows in audio/lines.csv");
    const bySrc = {}; [...missing.values()].forEach(a=>{ (bySrc[a.src]=bySrc[a.src]||[]).push(a); });
    if(missing.size && process.env.AUDIO_REPORT){ for(const [s,l] of Object.entries(bySrc)){ console.log("  MISSING "+s+" ("+l.length+")"); l.slice(0,40).forEach(a=>console.log("    - "+(a.text||a.raw))); } }
    else if(missing.size){ for(const [s,l] of Object.entries(bySrc)) console.log("  missing from lines.csv: "+s+" x"+l.length+" e.g. "+(l[0].text||l[0].raw)); }
    ok(missing.size === 0, "every spoken line the app can ask for has a row in audio/lines.csv ("+missing.size+" missing)");

    // ---- 2. a line in the CSV that nothing asks for any more is wasted money; report only ----
    const used = new Set(all.map(a=>a.id)); const unused = csvRows.filter(r=>r[0] && !used.has(r[0]) && !(r[2]==="tutorial") && !/^N:/.test(r[0]));
    console.log("INFO "+unused.length+" rows in lines.csv that this check did not see the app ask for (labels, shown-only text and family-list lines are expected here)");

    // ---- 3. what the app shows on screen that no line covers (non-failing; this is the tap-to-hear list) ----
    const screens = [
      ["home", `view.kid=null; render();`],
      ["kid morning", `view.kid="k1"; view.routine="am"; render();`], ["kid after school", `view.kid="k1"; view.routine="pm"; render();`],
      ["kid bedtime", `view.kid="k1"; view.routine="bt"; render();`], ["kid helper", `view.kid="k1"; view.routine="hp"; render();`], ["kid bonus", `view.kid="k1"; view.routine="bn"; render();`],
      ["shop", `view.kid="k1"; view.routine="am"; render(); buddySheet("k1");`], ["Hero HQ", `view.kid=null; render(); hqSheet("report");`], ["prize picker", `view.kid="k1"; render(); rewardSheet("k1");`],
      ["hero style", `view.kid="k1"; render(); styleSheet("k1");`], ["sound", `view.kid="k1"; render(); combinedSoundSheet("k1");`], ["joke", `jokeSheet();`], ["villain intro", `view.kid=null; render(); villainIntro();`],
      ["egg", `view.kid="k1"; render(); eggTaps=0; eggSheet("k1");`], ["sticker book", `view.kid="k1"; render(); bTab="stickers"; buddySheet("k1");`],
      ["trophy wall", `view.kid=null; render(); hqSheet("tro");`], ["getting to school", `view.kid=null; render(); rideSheet();`],
      ["damage card", `view.kid="k1"; render(); dmgPopNow(10);`], ["victory dance", `view.kid=null; render(); victoryDance();`]
    ];
    for(const t of ["hat","face","neck","fit","hold","pet","bg"]) screens.push(["shop: "+t, `view.kid="k1"; render(); bTab="${t}"; buddySheet("k1");`]);
    for(const part of ["body","color","size","ears","eyes","nose","mouth","pattern","tail"]) screens.push(["shop build: "+part, `view.kid="k1"; render(); bTab="build"; bPart="${part}"; buddySheet("k1");`]);
    const unvoiced = new Map();
    for(const [name, code] of screens){
      const lines = await ev(`(function(){ try{ layer.innerHTML=""; ${code} }catch(e){} const names=new Set(Object.values(KIDS).map(c=>c.name.toLowerCase())); const t=(document.getElementById("app").innerText+"\\n"+layer.innerText).split("\\n").map(s=>s.trim()).filter(s=>s && !names.has(s.toLowerCase())); layer.innerHTML=""; document.querySelectorAll(".dmgpop-ov,.disco").forEach(x=>x.remove()); return t; })()`) || [];
      for(const l of lines){ const n=norm(l); if(n.length<3 || /^\d[\d: apm/]*$/.test(n) || /^\d+$/.test(n)) continue; if(csvTexts.has(n)) continue; if(!unvoiced.has(n)) unvoiced.set(n,{text:l,screens:new Set()}); unvoiced.get(n).screens.add(name); }
    }
    console.log("INFO "+unvoiced.size+" distinct pieces of on-screen text have no matching line in lines.csv (kid and family names, numbers and sentences built from them included)");
    if(process.env.AUDIO_REPORT){ for(const u of [...unvoiced.values()].slice(0,400)) console.log("    ~ "+u.text.replace(/\s+/g," ").slice(0,80)+"   ["+[...u.screens].join(", ")+"]"); }
    if(process.env.AUDIO_JSON) fs.writeFileSync(process.env.AUDIO_JSON, JSON.stringify({unvoiced:[...unvoiced.values()].map(u=>({text:u.text.replace(/\s+/g," "),screens:[...u.screens]})), spoken:total, csvRows:csvKeys.size}, null, 1));
    console.log("INFO known dynamic lines (not clip-covered by design):"); DYNAMIC.forEach(d=>console.log("    * "+d));
  } catch(e){ fails++; console.log("EXCEPTION "+(e && e.stack || e)); }
  finally { try { ws.close(); } catch(e){} try { proc.kill(); } catch(e){} try { server.close(); } catch(e){} }
  console.log(fails ? "\nFAILED: "+fails+" check(s)" : "\nALL PASS");
  process.exit(fails ? 1 : 0);
}
run();
