// Speech that arrives on its own (cards, mission announcements, pop-ups) waits for a line that is already being said, and
// the surprise-mission announcement waits until the weekly prize is picked.
// Real Chromium over CDP (node >= 22, no deps).   Usage: node tests/polite-speech.test.js   (CHROME env var overrides the browser path)
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
const CDP_PORT = 19540, HTTP_PORT = 19541;
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mh-pl-"));
  const proc = spawn(CHROME, ["--headless=new","--remote-debugging-port="+CDP_PORT,"--user-data-dir="+dir,
    "--no-first-run","--disable-gpu","--no-default-browser-check","--disable-extensions","--mute-audio","--autoplay-policy=no-user-gesture-required","about:blank"], { stdio:"ignore" });
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
    await send("Page.navigate", { url: URL_ }); await ready(); await sleep(1500);
    await ev(`(function(){ window.__ev=[]; window.__t0=performance.now(); const pu=window.playUrl; window.playUrl=function(u,k){ window.__ev.push(["start",String(k),Math.round(performance.now()-window.__t0)]); return pu.apply(this,arguments); };
      player.addEventListener("ended", ()=>window.__ev.push(["ended",String(curClipKey),Math.round(performance.now()-window.__t0)])); return true; })()`);
    const evs = async () => JSON.parse(await ev(`JSON.stringify(window.__ev)`));
    const reset = () => ev(`window.__ev.length=0; window.__t0=performance.now(); true`);

    // 1. Waits for a line in progress
    await reset(); await ev(`play(["alldone"]); playPolite(["BJ:Tap the card to hear a joke!"], false); true`); await sleep(5000);
    let e = await evs(); const s1 = e.find(x=>x[0]==="start"&&x[1]==="alldone"), end1 = e.find(x=>x[0]==="ended"&&x[1]==="alldone"), s2 = e.find(x=>x[0]==="start"&&x[1].startsWith("BJ:Tap"));
    ok(s1 && end1 && s2 && s2[2] >= end1[2], "a waiting line starts only after the one being said has finished: " + JSON.stringify(e.map(x=>x.join(" "))));
    // 2. Sound effects do not make it wait
    await reset(); await ev(`play(["fanfare"]); playPolite(["alldone"], false); true`); await sleep(700);
    e = await evs(); const s3 = e.find(x=>x[0]==="start"&&x[1]==="alldone");
    ok(s3 && s3[2] < 500, "a sound effect does not hold it back: " + JSON.stringify(e.map(x=>x.join(" "))));
    await sleep(2500);
    // 3. The prize first, then the announcement
    await reset(); await ev(`weeks.k1.reward=null; view.kid="k1"; render(); rewardSheet("k1"); playPolite(["BJ:Emergency! THE SOCK HAS AWAKENED! Find stray socks and put them in the hamper!"], true); true`); await sleep(2500);
    e = await evs(); ok(!e.some(x=>x[0]==="start"&&x[1].startsWith("BJ:Emergency")), "while the prize sheet is open the announcement stays quiet");
    await ev(`weeks.k1.reward=REWARDS[0].id; saveWeek("k1"); close(); render(); true`); await sleep(1500);
    await sleep(2000);
    e = await evs(); ok(e.some(x=>x[0]==="start"&&x[1].startsWith("BJ:Emergency")), "once the prize is picked the announcement plays: " + JSON.stringify(e.map(x=>x.join(" "))));
    // 4. Two waiting lines keep their order and neither is cut
    await sleep(3000); await reset(); await ev(`play(["alldone"]); playPolite(["BJ:Tap the card to hear a joke!"], false); playPolite(["BJ:Nice hustle! All done without being asked twice!"], false); true`); await sleep(9000);
    e = await evs(); const starts = e.filter(x=>x[0]==="start").map(x=>x[1]);
    ok(starts.join("|") === "alldone|BJ:Tap the card to hear a joke!|BJ:Nice hustle! All done without being asked twice!", "waiting lines play in order: " + starts.join(" | "));
    const ends = e.filter(x=>x[0]==="ended").length; ok(ends >= 3, "and each one played all the way to its end (" + ends + " finished)");
  } catch(e){ fails++; console.log("EXCEPTION "+(e && e.stack || e)); }
  finally { try { ws.close(); } catch(e){} try { proc.kill(); } catch(e){} try { server.close(); } catch(e){} }
  console.log(fails ? "\nFAILED: "+fails+" check(s)" : "\nALL PASS");
  process.exit(fails ? 1 : 0);
}
run();
