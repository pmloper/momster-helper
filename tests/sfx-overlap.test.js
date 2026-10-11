// A sound effect at the start of a spoken line plays under the voice instead of making it wait for the whole effect.
// Real Chromium over CDP (node >= 22, no deps).   Usage: node tests/sfx-overlap.test.js   (CHROME env var overrides the browser path)
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
const CDP_PORT = 19526, HTTP_PORT = 19527;
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mh-sfx-"));
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
    await send("Page.navigate", { url: URL_ }); await ready();
    for(let i=0;i<40 && !(await ev(`AUDIO_READY`)); i++) await sleep(150);
    ok(await ev(`!!stitchCtxGet() && stitchCtx.state==="running"`), "Web Audio is running");
    await ev(`sfxWarm(); true`); await sleep(1200);
    ok((await ev(`["fanfare","bonus","ding","pop"].every(k=>sfxBuf.has(k))`)), "the sound effects were decoded ahead of time");
    await ev(`(function(){ window.__t0=0; window.__voice=[]; window.__sfx=[]; const pu=window.playUrl; window.playUrl=function(u,k){ window.__voice.push([String(k), Math.round(performance.now()-window.__t0)]); return pu.apply(this,arguments); };
      const orig=AudioContext.prototype.createBufferSource; AudioContext.prototype.createBufferSource=function(){ const s=orig.call(this); const st=s.start.bind(s); s.start=function(t){ window.__sfx.push(Math.round(performance.now()-window.__t0)); return st(t); }; return s; }; return true; })()`);
    // fanfare (1.9 s) + bonus (0.6 s) then a spoken line: it used to wait about 2.5 seconds
    await ev(`window.__t0=performance.now(); play(["fanfare","bonus","alldone"]); true`); await sleep(900);
    const v = JSON.parse(await ev(`JSON.stringify(window.__voice)`)), f = JSON.parse(await ev(`JSON.stringify(window.__sfx)`));
    ok(f.length === 2, "both effects were started: " + f.length);
    ok(v.length === 1 && v[0][0] === "alldone" && v[0][1] < 600, "the voice starts within about a third of a second (" + JSON.stringify(v) + ")");
    // A short effect is no different
    await ev(`window.__voice.length=0; window.__t0=performance.now(); play(["ding","alldone"]); true`); await sleep(700);
    const v2 = JSON.parse(await ev(`JSON.stringify(window.__voice)`)); ok(v2.length === 1 && v2[0][1] < 600, "ding then voice: " + JSON.stringify(v2));
    // Effects in the middle or at the end keep their place; a new play() cancels what was waiting
    await ev(`window.__voice.length=0; play(["fanfare","alldone"]); play(["pop"]); true`); await sleep(700);
    ok(!JSON.parse(await ev(`JSON.stringify(window.__voice.map(x=>x[0]))`)).includes("alldone"), "a new play() cancels the voice that was about to start");
    // Only an effect: nothing to overlap, it plays as before
    await ev(`window.__voice.length=0; play(["coin"]); true`); await sleep(300);
    ok(JSON.parse(await ev(`JSON.stringify(window.__voice.map(x=>x[0]))`)).join() === "coin", "an effect on its own still plays through the player");
    // Not unlocked yet (no running audio context): it falls back to the old order
    await ev(`stitchCtxGet=()=>null; stitchCtx=null; window.__voice.length=0; window.__t0=performance.now(); play(["ding","alldone"]); true`); await sleep(1500);
    ok(JSON.parse(await ev(`JSON.stringify(window.__voice.map(x=>x[0]))`)).join() === "ding,alldone", "without Web Audio the effect plays first, then the voice, as before");
  } catch(e){ fails++; console.log("EXCEPTION "+(e && e.stack || e)); }
  finally { try { ws.close(); } catch(e){} try { proc.kill(); } catch(e){} try { server.close(); } catch(e){} }
  console.log(fails ? "\nFAILED: "+fails+" check(s)" : "\nALL PASS");
  process.exit(fails ? 1 : 0);
}
run();
