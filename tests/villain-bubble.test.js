// The villain's speech bubble stays up for as long as he is talking, then fades; the new toot reactions are all in his voice.
// Real Chromium over CDP (node >= 22, no deps).   Usage: node tests/villain-bubble.test.js   (CHROME env var overrides the browser path)
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
const CDP_PORT = 19542, HTTP_PORT = 19543;
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mh-vb-"));
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
    await ev(`view.kid=null; render(); true`); await sleep(600);
    // A long reaction: the bubble must outlast the old 2.6 second timer and go only after the clip has ended
    const line = "Was that a toot or a tiny thunderstorm?";
    await ev(`(function(){ window.__t0=performance.now(); window.__end=null; window.__dur=0; player.addEventListener("loadedmetadata",()=>{ if(String(curClipKey).startsWith("V:")) window.__dur=player.duration; }); player.addEventListener("ended",()=>{ if(String(curClipKey).startsWith("V:")) window.__end=Math.round(performance.now()-window.__t0); });
      const boss=document.querySelector(".boss .bface"); const b=document.createElement("span"); b.className="taunt"; b.textContent=${JSON.stringify(line)}; boss.appendChild(b); window.__b=b; play([villainKey(monster(), ${JSON.stringify(line)})]); holdBubble(b,2600); return true; })()`);
    const hasClip = await ev(`!!voiceFile && !!villainFile(monster()[0], textKey(${JSON.stringify(line)}))`);
    ok(hasClip, "the new reaction has a clip in this villain's voice");
    await sleep(3000);
    const dur = await ev(`window.__dur`);
    ok(dur > 2.8, "the line is longer than the old 2.6 second bubble (" + dur + " s)");
    ok(await ev(`window.__b.isConnected && !window.__b.classList.contains("out")`), "after 3 seconds the bubble is still up while he talks");
    await sleep(Math.max(0, dur*1000 - 3000) + 2500);
    ok(!(await ev(`window.__b.isConnected`)), "once he has finished and a moment has passed, it is gone");
    const end = await ev(`window.__end`), gone = Math.round(await ev(`performance.now()-window.__t0`));
    ok(end !== null && end > 2600, "the clip ended after the old timer would have removed it (" + end + " ms)");
    // A line with no clip still gets the normal minimum time
    await ev(`(function(){ const boss=document.querySelector(".boss .bface"); const b=document.createElement("span"); b.className="taunt"; b.textContent="x"; boss.appendChild(b); window.__b2=b; window.__t1=performance.now(); holdBubble(b,2600); return true; })()`);
    await sleep(2300); ok(await ev(`window.__b2.isConnected`), "a silent bubble is still up at 2.3 seconds");
    await sleep(2200); ok(!(await ev(`window.__b2.isConnected`)), "and gone a little after the 2.6 second minimum");
    // All nine new reactions exist for every villain
    const miss = JSON.parse(await ev(`(async()=>{ const m=await (await fetch("audio/manifest.json")).json(); const lines=${JSON.stringify(["Excuse YOU!","Was that a toot or a tiny thunderstorm?","Open a window! Open ALL the windows!","My whole face is wilting!","That one had a FLAVOR!","Somebody call the toot police!","Did a trumpet just sneeze?","Phew! I can see the smell!","Hold on, I need a gas mask!"])}; const out=[]; for(const v of MONSTERS.map(x=>x[0])){ const have=new Set(m["villains/"+v]||m.villains&&m.villains[v]||[]); for(const l of lines) if(!have.has(textKey(l))) out.push(v+": "+l); } return JSON.stringify(out); })()`));
    ok(miss.length === 0, "all nine new reactions are recorded for all eight villains" + (miss.length ? ": " + miss.slice(0,3).join("; ") : ""));
  } catch(e){ fails++; console.log("EXCEPTION "+(e && e.stack || e)); }
  finally { try { ws.close(); } catch(e){} try { proc.kill(); } catch(e){} try { server.close(); } catch(e){} }
  console.log(fails ? "\nFAILED: "+fails+" check(s)" : "\nALL PASS");
  process.exit(fails ? 1 : 0);
}
run();
