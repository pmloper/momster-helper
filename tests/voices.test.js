// Voices: Momster voice 1 and 2 (a family-wide choice) and the eight villains' own fixed voices.
//   * Where a line is looked for: the chosen Momster voice, then voice 1; villain lines only in that villain's own folder; a line with
//     no clip plays nothing and the next line still plays.
//   * The villain pokes and toot reactions are said by the villain of the week.
//   * The Sound sheet offers Momster voice 1, voice 2 and a not-yet-available "record your own"; picking takes two taps and is saved.
//   * The manifest builder understands audio/villains/<id>/ and the tutorial follows the chosen voice.
// Real Chromium over CDP (node >= 22, no deps).   Usage: node tests/voices.test.js   (CHROME env var overrides the browser path)
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
const CDP_PORT = 19524, HTTP_PORT = 19525;
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mh-voice-"));
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




  const { execFileSync } = require("child_process");
  async function ready(){
    for(let i=0;i<40;i++){ if(await ev(`typeof DEFAULT_FAMILY === "object" && typeof villainKey === "function" && typeof MomsterTour !== "undefined" || typeof villainKey === "function"`)) return; await sleep(250); }
    throw new Error("app did not initialize");
  }
  try {
    await send("Page.navigate", { url: URL_ }); await ready();
    await ev(`localStorage.clear(); localStorage.setItem("starjobs_family", JSON.stringify(DEFAULT_FAMILY)); saveLocal("settings",{pin:"1234",goal:80,setupDone:true,avatars:{}}); saveLocal("intro_"+WEEK, 1); saveLocal("voiceLvl",1); saveLocal("vol",1); true`);
    await send("Page.navigate", { url: URL_ }); await ready();

    // ---- where each kind of line is looked for ----
    const R = await ev(`(function(){
      const got=[]; const realPlayUrl=playUrl; window.playUrl=(u,k)=>{ got.push(u); nextClip(); };
      const say=(keys,voice,talk)=>{ got.length=0; queue=[]; if(voice) settings.voice=voice; else delete settings.voice; voiceLvl=talk===0?0:1; soundLevel=1; play(keys); return got.slice(); };
      const kHi=textKey("Hello there!"), kSock=textKey("Pee-yew! Smell my socks!"), kDust=textKey("Achoo! I love dust!");
      AUDIO_INDEX={ momster:new Set([kHi,kSock]), momster2:new Set([kHi]), "villains/m_sock":new Set([kSock]) };
      const o={};
      o.default = say(["BJ:Hello there!"]);
      o.voice2 = say(["BJ:Hello there!"],"momster2");
      o.voice2Fallback = say(["BJ:Pee-yew! Smell my socks!"],"momster2");
      o.bogus = say(["BJ:Hello there!"],"squeaky");
      o.villain = say(["V:m_sock:Pee-yew! Smell my socks!"],"momster2");
      o.villainMissing = say(["V:m_dust:Achoo! I love dust!","BJ:Hello there!"]);
      o.villainNotFromMomster = say(["V:m_toy:Pee-yew! Smell my socks!"]);
      o.talkOff = say(["V:m_sock:Pee-yew! Smell my socks!"],null,0); voiceLvl=1;
      o.kD=kDust; window.playUrl=realPlayUrl; delete settings.voice; return o; })()`);
    ok(same(R.default,["audio/momster/"+encodeURIComponent(await ev(`textKey("Hello there!")`))+".mp3"]), "default is Momster voice 1: "+R.default);
    ok(R.voice2.length===1 && R.voice2[0].startsWith("audio/momster2/"), "Momster voice 2 plays from audio/momster2/: "+R.voice2);
    ok(R.voice2Fallback.length===1 && R.voice2Fallback[0].startsWith("audio/momster/"), "a line voice 2 doesn't have yet falls back to voice 1: "+R.voice2Fallback);
    ok(R.bogus.length===1 && R.bogus[0].startsWith("audio/momster/"), "an unknown or retired voice setting is treated as voice 1");
    ok(R.villain.length===1 && R.villain[0].startsWith("audio/villains/m_sock/"), "a villain's line plays from that villain's own folder, whatever Momster voice is chosen: "+R.villain);
    ok(R.villainMissing.length===1 && R.villainMissing[0].startsWith("audio/momster/"), "a villain line with no clip plays nothing and the next line still plays");
    ok(R.villainNotFromMomster.length===0, "a villain never borrows a clip from a Momster folder or another villain");
    ok(R.talkOff.length===0, "with talking off the villains are quiet too");

    // ---- the villain of the week says the pokes and toot reactions ----
    const V = await ev(`(function(){ const keys=[]; const realPlay=play; window.play=ks=>{ (ks||[]).forEach(k=>keys.push(k)); };
      view.kid=null; render(); const el=document.querySelector('[data-a="bossTap"]'); for(let i=0;i<6;i++) bossTap(el);
      const boss=document.querySelector(".boss .bface"); const btn=document.createElement("button"); document.body.appendChild(btn); for(let i=0;i<8;i++) tootAttack(btn); btn.remove();
      return new Promise(r=>setTimeout(()=>{ window.play=realPlay; r({keys, id:monster()[0]}); }, 1800)); })()`);
    const vk = V.keys.filter(k=>k.startsWith("V:"));
    ok(vk.length>=6 && vk.every(k=>k.startsWith("V:"+V.id+":")), "pokes and toot reactions are keyed to this week's villain ("+V.id+"), "+vk.length+" lines");
    ok(!V.keys.some(k=>k.startsWith("BJ:") && /^BJ:(Pee-yew|Nom nom|Achoo|Wheee!|Blub|The tiara|Pick a winner|Silent but deadly)/.test(k)), "no villain line is still sent as a plain Momster line");

    // ---- the Sound sheet ----
    await ev(`view.kid="k1"; view.routine="am"; render(); true`);
    await ev(`document.querySelector('.top.bar-card [data-a="sound"]').click(); true`); await sleep(400);
    const S1 = await ev(`(function(){ const sh=document.getElementById("csmSheet"); const tiles=[...sh.querySelectorAll('[data-a="vc"]')].map(b=>({v:b.dataset.v,t:b.textContent.trim(),on:b.classList.contains("on")}));
      const soon=[...sh.querySelectorAll(".rw")].find(b=>/Record your own/.test(b.textContent)); return {tiles, rws:[...sh.querySelectorAll(".rw")].map(b=>b.textContent.trim()), soon:!!soon, soonClickable:!!(soon&&soon.dataset.a), soonText:soon?soon.textContent.replace(/\\s+/g," ").trim():"", hasKidPicker:!!sh.querySelector('[data-a="soundKid"]')}; })()`);
    ok(same(S1.tiles.map(t=>t.v),["momster","momster2"]) && S1.tiles[0].on, "the Sound sheet offers Momster voice 1 (selected) and Momster voice 2: "+S1.tiles.map(t=>t.t).join(" / "));
    ok(S1.soon && !S1.soonClickable && /Coming soon/.test(S1.soonText), "'Record your own' is shown as coming soon and can't be tapped");
    ok(!S1.hasKidPicker, "the voice is one family-wide choice, no per-kid picker");
    await ev(`document.querySelector('[data-a="vc"][data-v="momster2"]').click(); true`); await sleep(200);
    ok(await ev(`(loadLocal("settings")||{}).voice!=="momster2" && !settings.voice`), "one tap only previews the voice, it doesn't save it");
    await ev(`document.querySelector('[data-a="vc"][data-v="momster2"]').click(); true`); await sleep(300);
    ok(await ev(`settings.voice==="momster2" && (loadLocal("settings")||{}).voice==="momster2"`), "a second tap picks it and saves it for the whole family");

    // ---- the tutorial follows the chosen voice ----
    await ev(`startTour(); true`); await sleep(900); await ev(`MomsterTour.finish(false); true`);
    const T = await ev(`(async function(){ const urls=[]; const realFetch=window.fetch; window.fetch=function(u){ urls.push(String(u)); return realFetch.apply(this,arguments); };
      AUDIO_INDEX=Object.assign({},AUDIO_INDEX,{momster2:new Set(["tour_1"]), momster:new Set(["tour_1","tour_2"])}); settings.voice="momster2";
      MomsterTour.start(); await new Promise(r=>setTimeout(r,500)); MomsterTour.goTo(1,0); await new Promise(r=>setTimeout(r,500)); MomsterTour.finish(false); window.fetch=realFetch;
      return urls.filter(u=>/tour_\\d+\\.mp3/.test(u)).map(u=>u.split("/").slice(-2).join("/")); })()`);
    ok(T.includes("momster2/tour_1.mp3") && !T.includes("momster/tour_1.mp3"), "the tutorial uses voice 2's clip when it has one: "+T.join(", "));
    ok(T.includes("momster/tour_2.mp3") && !T.includes("momster2/tour_2.mp3"), "and voice 1's clip when voice 2 doesn't have that line yet");

    // ---- the manifest builder ----
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mh-man-")); for(const d of ["momster","momster2","villains/m_sock","villains/m_toy","names/hi"]) fs.mkdirSync(path.join(tmp,"audio",d),{recursive:true});
    for(const f of ["audio/momster/a.mp3","audio/momster2/a.mp3","audio/villains/m_sock/x.mp3","audio/villains/m_toy/y.mp3","audio/names/hi/ana.mp3"]) fs.writeFileSync(path.join(tmp,f),"x");
    execFileSync(process.execPath,[path.join(REPO,"tools/build-audio-manifest.mjs")],{cwd:tmp,stdio:"ignore"});
    const man = JSON.parse(fs.readFileSync(path.join(tmp,"audio/manifest.json"),"utf8"));
    ok(same(man["villains/m_sock"],["x"]) && same(man["villains/m_toy"],["y"]) && same(man.momster2,["a"]) && same(man.names,{hi:["ana"]}), "the manifest lists each villain's folder and Momster voice 2: "+Object.keys(man).join(", "));
    fs.rmSync(tmp,{recursive:true,force:true});
  } catch(e){ fails++; console.log("EXCEPTION "+(e && e.stack || e)); }
  finally { try { ws.close(); } catch(e){} try { proc.kill(); } catch(e){} try { server.close(); } catch(e){} }
  console.log(fails ? "\nFAILED: "+fails+" check(s)" : "\nALL PASS");
  process.exit(fails ? 1 : 0);
}
run();
