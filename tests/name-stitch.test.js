// Kid names are stitched from a lead-in clip, the name on its own, and sometimes a tail; with any piece missing the
// whole sentence goes to the device voice instead. Real Chromium over CDP (node >= 22, no deps).
// Usage: node tests/name-stitch.test.js   (CHROME env var overrides the browser path)
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
const CDP_PORT = 19508, HTTP_PORT = 19509;
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mh-nst-"));
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
  const N = (t, n) => "N:" + t + ":" + n;
  try {
    await send("Page.navigate", { url: URL_ }); await ready();
    await ev(`localStorage.clear(); localStorage.setItem("starjobs_family", JSON.stringify(DEFAULT_FAMILY)); saveLocal("settings",{pin:"1234",goal:80,setupDone:true,avatars:{}}); saveLocal("intro_"+WEEK, 1); true`);
    await send("Page.navigate", { url: URL_ }); await ready(); await sleep(1500);
    // Record what would play instead of playing it
    await ev(`window.__log=[]; window.playUrl=function(u,k){ window.__log.push(decodeURIComponent(u.split("/").pop())); setTimeout(nextClip,0); };
      window.speakName=function(t,done){ window.__log.push("DEVICE:"+t); done(); }; window.enVoices=()=>[1]; window.ttsOk=false; true`);
    const run = async keys => { await ev(`window.__log.length=0; play(${JSON.stringify(keys)}); true`); await sleep(150); return JSON.parse(await ev(`JSON.stringify(window.__log)`)); };
    const have = async () => JSON.parse(await ev(`JSON.stringify(["nlead_hi","nlead_hero","ntail_ready","nm_emma","nm_zoey"].map(k=>!!voiceFile(k)))`));
    await ev(`AUDIO_INDEX.momster = new Set(["nlead_hi","nlead_justme","nlead_blame","nlead_hero","nlead_princess","nlead_knight","nlead_ninja","ntail_ready","nm_emma"]); true`);

    let l = await run([N("hi","Emma")]); ok(l.join()==="nlead_hi.mp3,nm_emma.mp3", "Hi + name: " + l.join(" + "));
    l = await run([N("justme","Emma")]); ok(l.join()==="nlead_justme.mp3,nm_emma.mp3", "Back to just + name: " + l.join(" + "));
    l = await run([N("blame","Emma")]); ok(l.join()==="nlead_blame.mp3,nm_emma.mp3", "I blame + name: " + l.join(" + "));
    l = await run([N("ready_hero","Emma")]); ok(l.join()==="nlead_hero.mp3,nm_emma.mp3,ntail_ready.mp3", "style line is lead + name + tail: " + l.join(" + "));
    l = await run([N("ready_ninja","Emma")]); ok(l.join()==="nlead_ninja.mp3,nm_emma.mp3,ntail_ready.mp3", "each style has its own lead-in: " + l.join(" + "));
    l = await run(["pop", N("hi","Emma"), "coin"]); ok(l.length===4 && l[1]==="nlead_hi.mp3" && l[2]==="nm_emma.mp3", "stitched pieces play in order between other clips: " + l.join(" + "));
    l = await run([N("hi","Émma")]); ok(l.join()==="nlead_hi.mp3,nm_emma.mp3", "accents and case do not matter (Émma finds nm_emma): " + l.join(" + "));
    l = await run([N("hi","Zoey")]); ok(l.length===1 && l[0]==="DEVICE:Hi Zoey!", "a name with no clip falls back to the device voice, whole sentence: " + l.join(" + "));
    await ev(`AUDIO_INDEX.momster.delete("ntail_ready"); true`);
    l = await run([N("ready_hero","Emma")]); ok(l.length===1 && l[0].startsWith("DEVICE:Super Emma, ready to help Momster"), "a missing tail also falls back to the device voice: " + l.join(" + "));
    l = await run([N("hi","Emma")]); ok(l.join()==="nlead_hi.mp3,nm_emma.mp3", "lines with no tail do not need one");
  } catch(e){ fails++; console.log("EXCEPTION "+(e && e.stack || e)); }
  finally { try { ws.close(); } catch(e){} try { proc.kill(); } catch(e){} try { server.close(); } catch(e){} }
  console.log(fails ? "\nFAILED: "+fails+" check(s)" : "\nALL PASS");
  process.exit(fails ? 1 : 0);
}
run();
