// Names that are not in the shipped list are requested from Convex once the family is signed in, a parent's "say it like" spelling is
// sent with it, family clips win over shipped ones, and unused clips are dropped. Convex is faked here.
// Real Chromium over CDP (node >= 22, no deps).   Usage: node tests/name-voices.test.js   (CHROME env var overrides the browser path)
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
const CDP_PORT = 19512, HTTP_PORT = 19513;
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mh-nv-"));
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
    for(let i=0;i<40 && !(await ev(`AUDIO_READY`)); i++) await sleep(150);
    ok(await ev(`AUDIO_READY`), "the audio list loaded");
    // A fake Convex client that records what the app asks for
    await ev(`(function(){ window.__calls=[]; window.__cb=null;
      window.MomsterCloud={ configured:true, signedIn:true, api:{voice:{myNameClips:"mine", requestName:"request", removeName:"remove"}},
        client:{ onUpdate:(fn,args,cb)=>{ window.__cb=cb; return ()=>{ window.__cb=null; }; },
                 action:(fn,args)=>{ window.__calls.push(["action",fn,JSON.stringify(args)]); return Promise.resolve({ok:true,key:"nm_"+nameSlug(args.name),url:"audio/momster/nlead_hi.mp3"}); },
                 mutation:(fn,args)=>{ window.__calls.push(["mutation",fn,JSON.stringify(args)]); return Promise.resolve(); } } };
      FAMILY.kids=[{id:"k1",name:"Emma",color:"#E2468A",av:"x"},{id:"k2",name:"Zaphod",color:"#1A9C74",av:"x"}]; applyKids(); nvStart(); return true; })()`);
    await sleep(300);
    const calls = async () => JSON.parse(await ev(`JSON.stringify(window.__calls.splice(0))`));
    let c = await calls();
    ok(c.length === 1 && c[0][1] === "request" && JSON.parse(c[0][2]).name === "Zaphod", "only the name that is not in the shipped list is requested: " + JSON.stringify(c));
    // The clip comes back through the subscription and is used
    await ev(`window.__cb([{key:"nm_zaphod", text:"Zaphod", respell:null, url:"https://files.example/zaphod.mp3"}]); true`);
    ok((await ev(`voiceFile("nm_zaphod")`)) === "https://files.example/zaphod.mp3", "the family's clip is found by the same key as shipped ones");
    ok((await ev(`JSON.stringify(nameParts("hi","Zaphod"))`)) === JSON.stringify(["NP:nlead_hi","NP:nm_zaphod"]), "the new name is stitched like any other");
    await sleep(200); c = await calls(); ok(c.length === 0, "nothing more is requested once the clip exists: " + JSON.stringify(c));
    // A respelling for a shipped name is requested and wins
    await ev(`FAMILY.kids[0].say="EM-uh"; NV.asked={}; nameVoicesEnsure(); true`); await sleep(200); c = await calls();
    ok(c.length >= 1 && c.some(x => x[1]==="request" && JSON.parse(x[2]).name==="Emma" && JSON.parse(x[2]).respell==="EM-uh"), "a say-it-like spelling is sent with the request: " + JSON.stringify(c));
    await ev(`window.__cb([{key:"nm_zaphod", text:"Zaphod", respell:null, url:"https://files.example/zaphod.mp3"},{key:"nm_emma", text:"Emma", respell:"EM-uh", url:"https://files.example/emma.mp3"}]); true`);
    ok((await ev(`voiceFile("nm_emma")`)) === "https://files.example/emma.mp3", "a family clip wins over the shipped one");
    await sleep(200); c = await calls(); ok(c.length === 0, "same spelling is not requested again: " + JSON.stringify(c));
    // Taking the spelling away drops the family clip so the shipped one is used again
    await ev(`FAMILY.kids[0].say=""; nameVoicesEnsure(); true`); await sleep(200); c = await calls();
    ok(c.some(x => x[1]==="remove" && JSON.parse(x[2]).name==="Emma"), "removing the spelling drops the family clip for a shipped name: " + JSON.stringify(c));
    // A kid who is removed: their clip is dropped
    await ev(`FAMILY.kids=[FAMILY.kids[0]]; window.__cb([{key:"nm_zaphod", text:"Zaphod", respell:null, url:"https://files.example/zaphod.mp3"}]); true`); await sleep(300); c = await calls();
    ok(c.some(x => x[1]==="remove" && JSON.parse(x[2]).name==="Zaphod"), "a clip nobody uses any more is dropped: " + JSON.stringify(c));
    // Signed out: nothing is requested
    await ev(`window.MomsterCloud.signedIn=false; NV.asked={}; FAMILY.kids=[{id:"k1",name:"Quentin",color:"#E2468A",av:"x"}]; nameVoicesEnsure(); true`); await sleep(200); c = await calls();
    ok(c.length === 0, "signed out: no requests (the device voice reads the name)");
  } catch(e){ fails++; console.log("EXCEPTION "+(e && e.stack || e)); }
  finally { try { ws.close(); } catch(e){} try { proc.kill(); } catch(e){} try { server.close(); } catch(e){} }
  console.log(fails ? "\nFAILED: "+fails+" check(s)" : "\nALL PASS");
  process.exit(fails ? 1 : 0);
}
run();
