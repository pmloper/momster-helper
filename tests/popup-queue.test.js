// Celebrations come one at a time. Finishing a routine can trigger the damage card, the "all done" banner, a combo, a new
// sticker, a busted villain and a mystery egg; they used to pile up on top of each other. Now each waits for the one before.
// Real Chromium over CDP (node >= 22, no deps).   Usage: node tests/popup-queue.test.js   (CHROME env var overrides the browser path)
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
const CDP_PORT = 19504, HTTP_PORT = 19505;
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mh-pop-"));
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



  async function ready(){
    for(let i=0;i<40;i++){ if(await ev(`typeof DEFAULT_FAMILY === "object" && typeof tapJob === "function" && typeof popup === "function"`)) return; await sleep(250); }
    throw new Error("app did not initialize");
  }
  try {
    await send("Page.navigate", { url: URL_ }); await ready();
    await ev(`localStorage.clear(); localStorage.setItem("starjobs_family", JSON.stringify(DEFAULT_FAMILY)); saveLocal("settings",{pin:"1234",goal:80,setupDone:true,avatars:{}}); saveLocal("intro_"+WEEK, 1); true`);
    await send("Page.navigate", { url: URL_ }); await ready();
    // The kid has already opened their card today and dismissed the mission popup.
    await ev(`layer.innerHTML=""; markMissionsSeen("k1"); view.kid="k1"; view.routine="bt"; render(); true`); await sleep(1200);
    await ev(`layer.innerHTML=""; popQ.length=0; popBusy=false; true`);
    // Both kids finish everything today except the first kid's last bedtime job, so the last tap finishes the whole day:
    // damage card, "all done" banner, combo, and a mystery egg all want the screen.
    await ev(`(function(){ layer.innerHTML=""; const day=ymd(new Date()), dow=todayDow();
      Object.keys(KIDS).forEach(k=>{ weeks[k].done=weeks[k].done||{}; weeks[k].done[day]=[]; ROUTINES.forEach(r=>jobsFor(r,dow,k).forEach(j=>weeks[k].done[day].push(j.id))); buddies[k].stickersInit=true; });
      const bt=ROUTINES.find(r=>r.id==="bt"), last=jobsFor(bt,dow,"k1").slice(-1)[0];
      weeks.k1.done[day]=weeks.k1.done[day].filter(x=>x!==last.id); window._last=last.id;
      view.kid="k1"; view.routine="bt"; render(); return true; })()`);
    await ev(`tapJob("k1", window._last); true`);
    let max = 0, kinds = new Set(), worst = "";
    // Nobody taps: the first card must still be there well past the old 5-second timeout, and nothing else may pile on top of it.
    await sleep(7500);
    ok(await ev(`!!document.querySelector(".dmgpop-ov")`), "the damage card waits for a tap (still showing after 7.5 seconds)");
    ok(await ev(`document.querySelectorAll(".cheer").length===0`), "no banner is shown on top of it while it waits");
    let idle = 0, cheersSeen = 0, cheersWaited = true;
    for(let i=0;i<400 && idle<30;i++){
      const s = await ev(`(function(){ const o={cheer:document.querySelectorAll(".cheer").length, dmg:document.querySelectorAll(".dmgpop-ov").length, sheet:layer.innerHTML?1:0, tap:document.querySelectorAll(".cheer.tapcard").length}; return o; })()`);
      const n = s.cheer + s.dmg + s.sheet;
      if(n > max){ max = n; worst = JSON.stringify(s); }
      if(s.cheer) kinds.add("banner"); if(s.dmg) kinds.add("damage card"); if(s.sheet) kinds.add("sheet/egg");
      idle = n ? 0 : idle + 1;
      if(s.dmg){ await sleep(500); await ev(`document.querySelector(".dmgpop-ov").click(); true`); }                 // the kid taps the card
      else if(s.tap){ cheersSeen++; await sleep(3200); if(!(await ev(`!!document.querySelector(".cheer.tapcard")`))) cheersWaited = false; await ev(`document.querySelector(".cheer.tapcard").click(); true`); }
      else if(await ev(`!!layer.querySelector(".egg")`)){ await sleep(300); await ev(`close(); true`); }              // the kid closes the egg
      await sleep(100);
    }
    ok(cheersSeen >= 2 && cheersWaited, "banners wait for a tap too (" + cheersSeen + " seen, each still showing 3.2 seconds later)");
    ok(max <= 1, "never more than one celebration on screen at once (worst: "+max+" "+worst+")");
    ok(kinds.size >= 2, "the sequence did show several different celebrations one after another: "+[...kinds].join(", "));

    // Merging still works: a second damage card while one is waiting or showing adds up instead of stacking.
    await ev(`(function(){ document.querySelectorAll(".cheer,.dmgpop-ov").forEach(x=>x.remove()); popQ.length=0; popBusy=false; layer.innerHTML=""; dmgPop(10); dmgPop(5); return true; })()`);
    await sleep(500);
    ok(await ev(`document.querySelectorAll(".dmgpop-ov").length===1 && document.querySelector(".dp-dmg").textContent.includes("15")`), "two damage cards close together become one card with the damage added: "+(await ev(`(document.querySelector(".dp-dmg")||{}).textContent`)));
    await ev(`document.querySelectorAll(".dmgpop-ov").forEach(x=>x.remove()); view.kid=null; render(); true`);
    ok(await ev(`!/assemble/i.test(document.querySelector(".hello h1").textContent)`), "the home header no longer says ', assemble'");
  } catch(e){ fails++; console.log("EXCEPTION "+(e && e.stack || e)); }
  finally { try { ws.close(); } catch(e){} try { proc.kill(); } catch(e){} try { server.close(); } catch(e){} }
  console.log(fails ? "\nFAILED: "+fails+" check(s)" : "\nALL PASS");
  process.exit(fails ? 1 : 0);
}
run();
