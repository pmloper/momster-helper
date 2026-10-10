// The development view (?dev=1): a bar to pick any villain and its health. It is off without the switch and saves nothing.
// Real Chromium over CDP (node >= 22, no deps).   Usage: node tests/dev-view.test.js   (CHROME env var overrides the browser path)
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
const CDP_PORT = 19532, HTTP_PORT = 19533;
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mh-dev-"));
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
    await send("Page.navigate", { url: URL_ }); await ready(); await sleep(1200);
    ok(!(await ev(`!!document.getElementById("devBar")`)), "without ?dev=1 there is no development bar");
    await send("Page.navigate", { url: URL_ + "?dev=1" }); await ready(); await sleep(1500);
    ok(await ev(`!!document.getElementById("devBar")`), "with ?dev=1 the bar shows");
    const ids = JSON.parse(await ev(`JSON.stringify(MONSTERS.map(m=>m[0]))`));
    const seen = new Set();
    for (const id of ids) {
      await ev(`(function(){ const s=document.getElementById("devSel"); s.value=${JSON.stringify(id)}; s.dispatchEvent(new Event("change",{bubbles:true})); return true; })()`); await sleep(250);
      const shown = JSON.parse(await ev(`JSON.stringify({id:monster()[0], face:(document.querySelector(".boss .bface")||{}).textContent||"", name:(document.querySelector(".boss")||{}).textContent||""})`));
      const want = JSON.parse(await ev(`JSON.stringify(MONSTERS.find(m=>m[0]===${JSON.stringify(id)}))`));
      ok(shown.id === id && shown.face.includes(want[2]) && shown.name.includes(want[1]), "the home screen shows " + want[2] + " " + want[1]);
      seen.add(shown.id);
    }
    ok(seen.size === ids.length && ids.length >= 8, "all " + ids.length + " villains can be picked");
    // Health presets
    await ev(`document.querySelector('[data-dv="hp"][data-p="0.3"]').click(); true`); await sleep(250);
    const pct = await ev(`Math.round(monsterLeft()/monsterHP()*100)`);
    ok(Math.abs(pct - 30) <= 1, "the 30% button sets the villain to 30% health: " + pct);
    await ev(`document.querySelector('[data-dv="hp"][data-p="0"]').click(); true`); await sleep(250);
    ok((await ev(`monsterLeft()`)) === 0 && (await ev(`(document.querySelector(".boss .bface")||{}).textContent`)).includes("😵"), "Defeated shows the knocked-out villain");
    const before = JSON.parse(await ev(`JSON.stringify(Object.keys(KIDS).map(k=>[buddies[k].monsters||null, buddies[k].coinAwards||{}]))`));
    await ev(`checkMonster(); true`); await sleep(300);
    const after = JSON.parse(await ev(`JSON.stringify(Object.keys(KIDS).map(k=>[buddies[k].monsters||null, buddies[k].coinAwards||{}]))`));
    ok(JSON.stringify(before) === JSON.stringify(after), "a pretend defeat awards no coins and saves nothing");
    await ev(`document.querySelector('[data-dv="hp"][data-p=""]').click(); true`); await sleep(250);
    ok((await ev(`monsterLeft()`)) > 0, "Real health puts the real numbers back");
    // The scenes can be triggered
    await ev(`document.querySelector('[data-dv="intro"]').click(); true`); await sleep(500);
    ok(await ev(`!!layer.querySelector(".intro")`), "the Intro button shows the villain's introduction");
    // Off again
    await send("Page.navigate", { url: URL_ + "?dev=0" }); await ready(); await sleep(1200);
    ok(!(await ev(`!!document.getElementById("devBar")`)), "?dev=0 turns it off again");
  } catch(e){ fails++; console.log("EXCEPTION "+(e && e.stack || e)); }
  finally { try { ws.close(); } catch(e){} try { proc.kill(); } catch(e){} try { server.close(); } catch(e){} }
  console.log(fails ? "\nFAILED: "+fails+" check(s)" : "\nALL PASS");
  process.exit(fails ? 1 : 0);
}
run();
