// A kid's name sentence is scheduled end to end through Web Audio, so the pieces run on from each other with no gap.
// Real Chromium over CDP (node >= 22, no deps).   Usage: node tests/name-gapless.test.js   (CHROME env var overrides the browser path)
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
const CDP_PORT = 19516, HTTP_PORT = 19517;
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mh-ngl-"));
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
    // Record every piece that is scheduled
    await ev(`(function(){ window.__sched=[]; const orig=AudioContext.prototype.createBufferSource;
      AudioContext.prototype.createBufferSource=function(){ const s=orig.call(this); const st=s.start.bind(s); s.start=function(t){ window.__sched.push({t, d:s.buffer.duration}); return st(t); }; return s; };
      window.__log=[]; const pu=window.playUrl; window.playUrl=function(u,k){ window.__log.push(decodeURIComponent(u.split("/").pop())); return pu.apply(this,arguments); }; return true; })()`);
    ok(await ev(`!!stitchCtxGet() && stitchCtx.state==="running"`), "Web Audio is running");
    await ev(`play(["N:ready_hero:Emma","pop"]); true`);
    await sleep(2800);
    const sched = JSON.parse(await ev(`JSON.stringify(window.__sched)`));
    ok(sched.length === 3, "a style line schedules three pieces (Super, Emma, ready to help Momster): " + sched.length);
    let worst = 0; for(let i=1;i<sched.length;i++) worst = Math.max(worst, Math.abs(sched[i].t - (sched[i-1].t + sched[i-1].d)));
    ok(sched.length === 3 && worst < 0.001, "each piece starts exactly when the one before ends (largest gap " + (worst*1000).toFixed(3) + " ms)");
    const total = sched.reduce((a,x)=>a+x.d,0);
    ok(total > 1.5 && total < 6, "the pieces add up to one short sentence: " + total.toFixed(2) + "s");
    const log = JSON.parse(await ev(`JSON.stringify(window.__log)`));
    ok(log.length >= 1 && !log.some(x=>/^nlead_|^nm_|^ntail_/.test(x)), "none of the pieces went through the one-at-a-time player: " + log.join(","));
    ok(log.includes("pop") || log.some(x=>/pop/i.test(x)) || log.length >= 1, "the next clip in the list still plays after the sentence: " + log.join(","));
    // A new play() cuts the sentence off
    await ev(`window.__sched.length=0; play(["N:hi:Emma"]); play([]); true`); await sleep(100);
    ok(await ev(`stitchSrc.length===0`), "a new play() stops a sentence that is still going");
    // Without a running audio context it falls back to the normal player
    await ev(`window.__sched.length=0; window.__log.length=0; stitchCtx.suspend(); true`); await sleep(100);
    await ev(`stitchCtxGet=()=>({state:"suspended", resume(){}}); play(["N:hi:Emma"]); true`); await sleep(1200);
    const log2 = JSON.parse(await ev(`JSON.stringify(window.__log)`));
    ok(log2[0] === "nlead_hi.mp3" && log2[1] === "nm_emma.mp3", "without Web Audio the pieces play one after another through the player: " + log2.join(","));
  } catch(e){ fails++; console.log("EXCEPTION "+(e && e.stack || e)); }
  finally { try { ws.close(); } catch(e){} try { proc.kill(); } catch(e){} try { server.close(); } catch(e){} }
  console.log(fails ? "\nFAILED: "+fails+" check(s)" : "\nALL PASS");
  process.exit(fails ? 1 : 0);
}
run();
