// Tap-to-hear: a plain label marked data-say reads itself aloud; a label inside a button keeps the button's own action.
// Real Chromium over CDP (node >= 22, no deps).   Usage: node tests/tap-to-hear.test.js   (CHROME env var overrides the browser path)
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
const CDP_PORT = 19506, HTTP_PORT = 19507;
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mh-tth-"));
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
    await send("Page.navigate", { url: URL_ }); await ready(); await sleep(1500);
    await ev(`window.__said=[]; window.play=function(k){ window.__said.push(k); }; true`);
    const click = async sel => { await ev(`document.querySelector(${JSON.stringify(sel)}).click(); true`); };
    const said = () => ev(`JSON.stringify(window.__said.splice(0).flat())`).then(JSON.parse);

    // Team rank and a kid's award in Hero HQ
    await ev(`hqSheet("report"); true`);
    await click(".hq-rank b[data-say]");
    let s = await said(); ok(s.length === 1 && s[0].startsWith("BJ:") && s[0].length > 3, "tapping the team rank name says it: " + s.join("|"));
    await click(".hq-aw b[data-say]");
    s = await said(); ok(s.length === 1 && s[0].startsWith("BJ:"), "tapping a hero award says it: " + s.join("|"));

    // Earned stickers speak, locked ones (???) do not
    await ev(`layer.innerHTML=""; buddies.k1.stickers=[STICKERS[0][0]]; const d=document.createElement("div"); d.id="sb"; d.innerHTML=stickerBook("k1"); document.body.appendChild(d); true`);
    const counts = await ev(`JSON.stringify({got:document.querySelectorAll("#sb .stk.got[data-say]").length, locked:document.querySelectorAll("#sb .stk:not(.got)[data-say]").length})`);
    ok(JSON.parse(counts).got === 1 && JSON.parse(counts).locked === 0, "only earned stickers are tap-to-hear: " + counts);
    await click("#sb .stk.got");
    s = await said(); ok(s.length === 1 && s[0] === "BJ:" + (await ev(`STICKERS[0][2]`)), "tapping an earned sticker says its name: " + s.join("|"));

    // A label inside a button does not fire (the button owns the tap)
    await ev(`const b=document.createElement("button"); b.id="btnlbl"; b.dataset.a="noop"; b.innerHTML='<span id="inner" data-say="Joke">Joke</span>'; document.body.appendChild(b); true`);
    await click("#inner"); s = await said(); ok(s.length === 0, "a label inside a button keeps the button's action");
    // ...but a label inside the dimmed sheet background still speaks
    await ev(`const o=document.createElement("div"); o.dataset.a="closeOv"; o.innerHTML='<span id="inov" data-say="Joke">Joke</span>'; document.body.appendChild(o); true`);
    await click("#inov"); s = await said(); ok(s.length === 1 && s[0] === "BJ:Joke", "a label inside the overlay background speaks: " + s.join("|"));

    // Every label the app marks has a clip
    const miss = await ev(`(async()=>{ const m=await (await fetch("audio/manifest.json")).json(), have=new Set(m.momster);
      const texts=[...RANKS.map(r=>r[2]), ...Object.values(AWARDS).map(a=>a[1]), ...STICKERS.map(x=>x[2])];
      return JSON.stringify(texts.filter(t=>!have.has(textKey(t)))); })()`);
    ok(miss === "[]", "ranks, awards and sticker names all have a Momster clip: " + miss);
  } catch(e){ console.log("FAIL "+e.message); fails++; }
  console.log(fails ? "\nFAILED: "+fails+" check(s)" : "\nALL PASS");
  try{ ws.close(); }catch(e){} proc.kill(); server.close();
  process.exit(fails ? 1 : 0);
}
run();
