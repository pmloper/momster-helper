// Momster's tutorial (tour.js): ten narrated clips that light up the real screens while she talks.
//   * Static: every clip and pose picture exists, the captions match the recorded script, the sound-option rules hold
//   * Browser (real Chromium over CDP, node >= 22, no deps): the tour runs from the first line to the last, the right screen
//     and a highlight are behind each caption, no popups or data changes happen behind it, the reward pays once, Skip and
//     Back work, and it works at phone and tablet sizes without the caption box leaving the screen
// Usage: node tests/tour.test.js   (CHROME env var overrides the browser path)
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
const CDP_PORT = 19494, HTTP_PORT = 19495;
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mh-tour-"));
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


  const tourJs = fs.readFileSync(path.join(REPO,"tour.js"),"utf8");
  // ---------- static ----------
  const clips = [...Array(10).keys()].map(i=>path.join(REPO,"audio/momster/tour_"+(i+1)+".mp3"));
  ok(clips.every(f=>fs.existsSync(f)), "all ten recorded lines are in audio/momster/tour_1..10.mp3");
  ok(["wave","stand","point","thumbs","cheer"].every(n=>fs.existsSync(path.join(REPO,"art/momster/"+n+".webp"))), "all five Momster pose pictures exist");
  ok(!/avatar/i.test(tourJs), "the captions say sidekick, never avatar");
  ok(/sidekick/.test(tourJs) && /ten more coins/.test(tourJs) && /25 coins/.test(tourJs), "the captions match the recorded script's coin facts");
  ok(!/soundLevel===0\)\s*return/.test(tourJs) && !/speechSynthesis/.test(tourJs), "the tutorial never goes quiet because of the sound option and never uses the device voice");

  async function ready(){
    for(let i=0;i<40;i++){ if(await ev(`typeof DEFAULT_FAMILY === "object" && typeof saveLocal === "function" && typeof startTour === "function"`)) return; await sleep(250); }
    throw new Error("app did not initialize");
  }
  async function fresh(sound){
    await send("Page.navigate", { url: URL_ }); await ready();
    await ev(`localStorage.clear(); localStorage.setItem("starjobs_family", JSON.stringify(DEFAULT_FAMILY)); saveLocal("settings",{pin:"1234",goal:80,setupDone:true,avatars:{}}); saveLocal("intro_"+WEEK, 1); ${sound==="off"?'saveLocal("vol",0); saveLocal("voiceLvl",0);':""} true`);
    await send("Page.navigate", { url: URL_ }); await ready();
    await ev(`layer.innerHTML=""; view.kid=null; render(); true`);
  }
  const state = () => ev(`(function(){ const s=MomsterTour.state, t=document.getElementById("tour"); if(!t) return null;
    const h=t.querySelector(".thole").getBoundingClientRect(), b=t.querySelector(".tbub").getBoundingClientRect(), m=t.querySelector(".tmw").getBoundingClientRect();
    return {i:s.i, j:s.j, wait:s.waiting, kid:view.kid, lit:t.classList.contains("tlit"), intro:t.classList.contains("tintro"), cap:t.querySelector(".tcap").textContent,
      hole:[h.left,h.top,h.right,h.bottom], bubIn:(b.left>=-1&&b.top>=-1&&b.right<=innerWidth+1&&b.bottom<=innerHeight+1), momIn:(m.left>=-1&&m.top>=-1&&m.right<=innerWidth+1&&m.bottom<=innerHeight+1),
      layerOpen:!!layer.innerHTML, pose:t.querySelector(".tmo").getAttribute("src")}; })()`);

  async function walk(label, check){
    const seen = []; let last = "";
    for(let g=0; g<80; g++){
      const s = await state(); if(!s) break;
      const key = s.i+"."+s.j+(s.wait?"w":"");
      if(key !== last){ seen.push(s); if(check) check(s); last = key; }
      await sleep(520); await ev(`MomsterTour.next(); true`); await sleep(180);
    }
    return seen;
  }

  try {
    await fresh();
    const before = await ev(`JSON.stringify([weeks, buddies, settings])`);
    await ev(`startTour(); true`); await sleep(900);
    ok(await ev(`!!window.tourOn && !!document.getElementById("tour")`), "startTour() opens the tutorial");
    ok(await ev(`document.getElementById("tour").getAttribute("role")==="dialog"`), "the tutorial is announced as a dialog");
    let bad = [];
    const seen = await walk("phone", s=>{
      if(s.layerOpen) bad.push("popup behind "+s.i+"."+s.j);
      if(!s.bubIn) bad.push("caption box off screen "+s.i+"."+s.j);
      if(!s.momIn) bad.push("Momster off screen "+s.i+"."+s.j);
      if(!s.intro && !s.lit) bad.push("no highlight at "+s.i+"."+s.j);
      if(s.lit && (s.hole[2]-s.hole[0]<10 || s.hole[3]-s.hole[1]<10)) bad.push("empty highlight at "+s.i+"."+s.j);
    });
    ok(seen.length >= 40, "every caption shows in turn ("+seen.length+" screens)");
    ok(bad.length===0, "no popup, no off-screen box, no missing highlight: "+bad.slice(0,4).join("; "));
    ok(seen.slice(0,6).every(s=>s.intro), "the first two clips are Momster on her own (no highlights)");
    ok(seen.filter(s=>s.i===0).every(s=>s.cap.length>0) && new Set(seen.filter(s=>s.i<2).map(s=>s.pose)).size>=2, "she changes pose while she talks");
    const views = seen.map(s=>s.kid?"kid":"home");
    ok(views.includes("home") && views.includes("kid"), "the tour shows both the home screen and a kid's screen");
    ok(seen.find(s=>s.i===3&&s.j===2).kid==="k1" && seen.find(s=>s.i===3&&s.j===1).kid===null, "it taps into the first kid's card to talk about the prize");
    ok(!(await ev(`!!window.tourOn`)) && !(await ev(`!!document.getElementById("tour")`)), "the tour closes itself after the last line");
    ok(await ev(`view.kid===null`), "and puts the app back on the home screen");
    ok(same(await ev(`Object.keys(KIDS).map(k=>coins(k))`),[25,25]), "the reward line gave each kid 25 coins");
    const after = JSON.parse(await ev(`JSON.stringify([weeks, buddies, settings])`)), b4 = JSON.parse(before);
    ok(same(after[0],b4[0]) && same(after[2],b4[2]), "no stars, jobs or settings were changed by watching it");
    ok(same(Object.keys(after[1]).map(k=>Object.keys(after[1][k].coinAwards)), [["starter"],["starter"]]), "the only thing written is the one starter award per kid");

    // watching it again never pays twice; Skip pays nothing and leaves everything as it was
    await ev(`startTour(); true`); await sleep(500); await ev(`MomsterTour.reward(); true`); await sleep(300); await ev(`MomsterTour.finish(true); true`);
    ok(same(await ev(`Object.keys(KIDS).map(k=>coins(k))`),[25,25]), "watching again does not pay the 25 coins twice");
    await fresh();
    await ev(`startTour(); true`); await sleep(700);
    await ev(`MomsterTour.goTo(3,0); true`); await sleep(700);
    const mid = await state(); ok(mid && mid.i===3, "jumping ahead lands on that clip");
    await ev(`document.querySelector("#tour .tback").click(); true`); await sleep(500);
    ok((await state()).i===3 || (await state()).i===2, "Back goes to the start of this clip or the one before");
    await ev(`document.querySelector("#tour .tskip").click(); true`); await sleep(400);
    ok(!(await ev(`!!window.tourOn`)) && same(await ev(`Object.keys(KIDS).map(k=>coins(k))`),[0,0]), "Skip closes the tour and gives no coins");
    ok(await ev(`view.kid===null && !layer.innerHTML`), "Skip leaves the home screen clean");

    // it talks even when the family chose Off, and the pictures/sound live in the blob player, not the sound queue
    await fresh("off");
    await ev(`startTour(); true`); await sleep(1200);
    ok(await ev(`(function(){ return player.src.indexOf("blob:")===0 || player.src.indexOf("tour_1.mp3")>0; })()`), "with sound set to Off the tutorial still plays its voice");
    ok(await ev(`player.volume>0 && !player.muted`), "at full volume, not muted");
    await ev(`document.querySelector("#tour .tmute").click(); true`);
    ok(await ev(`player.muted===true`), "the speaker button mutes her (captions stay)");
    await ev(`MomsterTour.finish(false); true`);
    ok(await ev(`player.muted===false`), "and the app's own sound is unmuted when the tutorial ends");

    // Grown-ups can replay it
    await fresh();
    await ev(`panel(); true`); await sleep(200);
    ok(await ev(`!!document.querySelector('#gPanel [data-a="tour"]')`), "Grown-ups has a Watch the tutorial button");
    await ev(`document.querySelector('#gPanel [data-a="tour"]').click(); true`); await sleep(900);
    ok(await ev(`!!window.tourOn && !layer.innerHTML`), "tapping it starts the tutorial");
    await ev(`MomsterTour.finish(false); true`);

    // phone landscape and tablet sizes
    for(const [w,h] of [[844,390],[390,800],[1024,700]]){
      await send("Emulation.setDeviceMetricsOverride",{width:w,height:h,deviceScaleFactor:1,mobile:true});
      await fresh(); await ev(`startTour(); true`); await sleep(800);
      const prob = []; await walk(w+"x"+h, s=>{ if(!s.bubIn) prob.push("box "+s.i+"."+s.j); if(!s.momIn) prob.push("mom "+s.i+"."+s.j); });
      ok(prob.length===0, "caption box and Momster stay on screen at "+w+"x"+h+(prob.length?": "+prob.slice(0,3).join(", "):""));
    }
  } catch(e){ fails++; console.log("EXCEPTION "+(e && e.stack || e)); }
  finally { try { ws.close(); } catch(e){} try { proc.kill(); } catch(e){} try { server.close(); } catch(e){} }
  console.log(fails ? "\nFAILED: "+fails+" check(s)" : "\nALL PASS");
  process.exit(fails ? 1 : 0);
}
run();
