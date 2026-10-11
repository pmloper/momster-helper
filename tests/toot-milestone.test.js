// The family-toot milestone card says its whole text out loud, and keeps its voice while the kid keeps tooting.
// Real Chromium over CDP (node >= 22, no deps).   Usage: node tests/toot-milestone.test.js   (CHROME env var overrides the browser path)
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
const CDP_PORT = 19522, HTTP_PORT = 19523;
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mh-tm-"));
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
    await ev(`localStorage.clear(); localStorage.setItem("starjobs_family", JSON.stringify(DEFAULT_FAMILY)); saveLocal("settings",{pin:"1234",goal:80,setupDone:true,avatars:{}}); saveLocal("intro_"+WEEK, 1); saveLocal("toots", 9); true`);
    await send("Page.navigate", { url: URL_ }); await ready(); await sleep(1500);
    await ev(`(function(){ window.__k=[]; const p=window.play; window.play=function(k){ window.__k.push(JSON.stringify(k)); return p.apply(this,arguments); }; view.kid=null; render(); return true; })()`); await sleep(800);
    await ev(`document.querySelector('[data-a="toot"]').click(); true`); await sleep(5500);   // the card waits for the villain to finish before it speaks
    ok((await ev(`(document.querySelector(".cheer")||{}).textContent||""`)).includes("10 family toots!"), "the 10th toot shows the milestone card");
    const keys = JSON.parse(await ev(`JSON.stringify(window.__k.map(x=>JSON.parse(x)).flat())`));
    ok(keys.includes("BJ:10 family toots!") && keys.includes("BJ:The dog is taking the blame.") && keys.indexOf("BJ:10 family toots!") < keys.indexOf("BJ:The dog is taking the blame."), "it says the count, then the funny line: " + keys.join(" , "));
    const haveClips = JSON.parse(await ev(`JSON.stringify(["10 family toots!","The dog is taking the blame."].map(t=>!!voiceFile(textKey(t))))`));
    ok(haveClips.every(Boolean), "both pieces have a clip");
    // The kid taps the toot button again while the card is up: that tap only closes the card (no toot, no villain line talking over it)
    await ev(`window.__k.length=0; true`);
    await ev(`document.querySelector('[data-a="toot"]').click(); true`); await sleep(1200);
    const after = JSON.parse(await ev(`JSON.stringify(window.__k.map(x=>JSON.parse(x)).flat())`));
    ok(!(await ev(`!!document.querySelector(".cheer.tapcard")`)), "a tap outside the card closes it");
    ok(!after.some(k=>String(k).startsWith("V:")), "and that tap did not make the villain talk over the card: " + after.join(" , "));
    // The villain's reaction is finished before the milestone is spoken
    await send("Page.navigate", { url: URL_ }); await ready(); await sleep(1500);
    await ev(`saveLocal("toots", 9); view.kid=null; render(); true`); await sleep(800);
    await ev(`(function(){ window.__ev=[]; const t0=performance.now(); const pu=window.playUrl; window.playUrl=function(u,k){ window.__ev.push(["start",String(k),Math.round(performance.now()-t0)]); return pu.apply(this,arguments); };
      player.addEventListener("ended", ()=>window.__ev.push(["ended",String(curClipKey),Math.round(performance.now()-t0)])); return true; })()`);
    await ev(`document.querySelector('[data-a="toot"]').click(); true`); await sleep(7000);
    const evs = JSON.parse(await ev(`JSON.stringify(window.__ev)`));
    const v = evs.find(e => e[0]==="start" && e[1].startsWith("V:")), vEnd = evs.find(e => e[0]==="ended" && e[1].startsWith("V:")), m = evs.find(e => e[0]==="start" && e[1]==="BJ:10 family toots!");
    ok(v && vEnd && m, "the villain's line and the milestone both played: " + JSON.stringify(evs.map(e=>e.join(" "))));
    ok(v && vEnd && m && m[2] >= vEnd[2], "the milestone waits until the villain has finished his line (villain ended at " + (vEnd&&vEnd[2]) + " ms, milestone started at " + (m&&m[2]) + " ms)");
    ok(await ev(`(document.querySelector(".cheer")||{}).textContent||""`).then(t=>t.includes("10 family toots!")), "the card itself is already on screen while it waits");
    // Every milestone has its own punchline, and every one is recorded
    await send("Page.navigate", { url: URL_ }); await ready(); await sleep(1500);
    const punch = JSON.parse(await ev(`JSON.stringify(TOOT_PUNCH)`));
    const counts = Object.keys(punch).map(Number);
    ok(counts.join() === "10,25,50,100,200,500", "milestones are 10, 25, 50, 100, 200 and 500");
    ok(new Set(Object.values(punch)).size === counts.length, "each milestone has a different punchline");
    const recorded = JSON.parse(await ev(`JSON.stringify(Object.values(TOOT_PUNCH).concat(Object.keys(TOOT_PUNCH).map(c=>c+" family toots!")).filter(t=>!voiceFile(textKey(t))))`));
    ok(recorded.length === 0, "the count and the punchline are recorded for every milestone" + (recorded.length ? ": missing " + recorded.join("; ") : ""));
    for (const c of [25, 200]) {
      await ev(`saveLocal("toots", ${c - 1}); view.kid=null; render(); true`); await sleep(700);
      await ev(`document.querySelector('[data-a="toot"]').click(); true`); await sleep(2200);
      const t = await ev(`(document.querySelector(".cheer")||{}).textContent||""`);
      ok(t.includes(c + " family toots!") && t.includes(punch[c]), "the " + c + " card shows its own punchline: " + t);
      await ev(`document.querySelectorAll(".cheer").forEach(x=>x.remove()); popQ.length=0; popBusy=false; true`);
    }
  } catch(e){ fails++; console.log("EXCEPTION "+(e && e.stack || e)); }
  finally { try { ws.close(); } catch(e){} try { proc.kill(); } catch(e){} try { server.close(); } catch(e){} }
  console.log(fails ? "\nFAILED: "+fails+" check(s)" : "\nALL PASS");
  process.exit(fails ? 1 : 0);
}
run();
