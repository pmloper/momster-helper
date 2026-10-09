// Hero-style costumes are drawn over the sidekick and never unlock or replace anything; the two hands ask before swapping.
// Real Chromium over CDP (node >= 22, no deps).   Usage: node tests/costume-hands.test.js   (CHROME env var overrides the browser path)
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
const CDP_PORT = 19510, HTTP_PORT = 19511;
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mh-cos-"));
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
    const J = x => JSON.stringify(x);
    const get = async expr => JSON.parse(await ev(`JSON.stringify(${expr})`));
    await ev(`view.kid="k1"; render(); buddies.k1.owned=["balloon","popcorn","ball","kitty","sword","shield"]; buddies.k1.coins=999; buddies.k1.wear={}; settings.heroStyle={}; true`);

    // 1. Picking a costume gives nothing and changes nothing
    const before = await get(`({owned:buddies.k1.owned.slice(), wear:buddies.k1.wear, look:buddies.k1.look})`);
    await ev(`applyStyle("k1","knight"); true`);
    const after = await get(`({owned:buddies.k1.owned, wear:buddies.k1.wear, look:buddies.k1.look})`);
    ok(J(before) === J(after), "picking Knight changes nothing the sidekick owns, wears or looks like");
    const dw = await get(`dressed("k1").wear`);
    ok(dw.hat === "khelm" && dw.fit === "f_armor" && dw.hold === "sword" && dw.hold2 === "shield", "but the sidekick is drawn in the knight costume: " + J(dw));
    ok((await get(`buddies.k1.owned.includes("khelm")||buddies.k1.owned.includes("f_armor")`)) === false, "the helmet and armor are not unlocked");

    // 2. Hands full (sword + shield from the costume): a new toy asks first, and changes nothing yet
    await ev(`bTab="hold"; buddySheet("k1"); true`);
    await ev(`document.querySelector('[data-a="bItem"][data-v="popcorn"]').click(); true`);
    ok(await ev(`!!layer.querySelector(".handsfull")`), "tapping a toy with both hands full shows the red Hands full card");
    ok((await ev(`layer.querySelectorAll('[data-a="putAway"]').length`)) === 2, "it offers to put away each of the two things being held");
    ok((await get(`buddies.k1.wear.hold||null`)) === null, "nothing was swapped behind the kid's back");

    // 3. Put the sword away: popcorn goes in the left hand, the shield stays in the right
    await ev(`layer.querySelector('[data-a="putAway"][data-h="hold"]').click(); true`);
    let d = await get(`dressed("k1").wear`);
    ok(d.hold === "popcorn" && d.hold2 === "shield", "put away the sword: popcorn in the left hand, shield in the right: " + J(d));
    ok((await get(`buddies.k1.stowed`)).includes("sword"), "the sword is put away, not lost or unlocked");

    // 4. Try to bring the sword back: hands full again, so it asks again
    await ev(`bTab="hold"; buddySheet("k1"); document.querySelector('[data-a="bItem"][data-v="sword"]').click(); true`);
    ok(await ev(`!!layer.querySelector(".handsfull")`), "the sword asks too, because the hands are full");
    // Put away the popcorn (the kid's own): the sword takes the left hand, the shield stays right, nothing else moves
    await ev(`layer.querySelector('[data-a="putAway"][data-h="hold"]').click(); true`);
    d = await get(`dressed("k1").wear`);
    ok(d.hold === "sword" && d.hold2 === "shield", "put away the popcorn: sword left, shield right: " + J(d));

    // 5. Own toys: first goes left, second goes right, a third asks and replaces the older one in the same hand
    await ev(`applyStyle("k1","none"); buddies.k1.wear={}; buddies.k1.stowed=[]; bTab="hold"; buddySheet("k1"); true`);
    const tap = async (id, tab="hold") => { await ev(`bTab=${J(tab)}; buddySheet("k1"); document.querySelector('[data-a="bItem"][data-v="${id}"]').click(); true`); };
    await tap("balloon"); await tap("popcorn");
    let w = await get(`buddies.k1.wear`);
    ok(w.hold === "balloon" && w.hold2 === "popcorn", "first toy goes in the left hand, second in the right: " + J(w));
    await tap("ball");
    ok(await ev(`!!layer.querySelector(".handsfull")`), "a third toy asks first");
    await ev(`layer.querySelector('[data-a="putAway"][data-h="hold"]').click(); true`);   // put away the balloon (left)
    w = await get(`buddies.k1.wear`);
    ok(w.hold === "ball" && w.hold2 === "popcorn", "the ball takes the hand the balloon was in: " + J(w));
    // A pet needs a hand too
    await tap("kitty","pet");
    ok(await ev(`!!layer.querySelector(".handsfull")`), "a pet asks when two toys are held");
    await ev(`layer.querySelector('[data-a="putAway"][data-h="hold2"]').click(); true`);
    w = await get(`buddies.k1.wear`);
    ok(w.pet === "kitty" && w.hold === "ball" && !w.hold2, "put away the popcorn: ball in one hand, kitty in the other: " + J(w));
    // Tapping something worn takes it off with no question
    await tap("ball");
    ok(!(await ev(`!!layer.querySelector(".handsfull")`)) && !(await get(`buddies.k1.wear.hold||null`)), "tapping a worn toy just puts it away");

    // 6. Older saves that merged the costume into the sidekick get their own things back
    await ev(`settings.heroStyle={k1:"ninja"}; buddies.k1.wear={face:"nmask",fit:"f_gi",hat:"cap"}; buddies.k1.look.ears="none"; buddies.k1.base={look:{ears:"bear"},wear:{hat:"cap"}}; delete buddies.k1.costumeFixed; fixCostumes(); true`);
    const mig = await get(`({wear:buddies.k1.wear, ears:buddies.k1.look.ears, base:!!buddies.k1.base})`);
    ok(J(mig.wear) === J({hat:"cap"}) && mig.ears === "bear" && !mig.base, "an older saved costume is unpicked back into the kid's own look: " + J(mig));

    // 7. Coin prices sit in the middle of their pills
    await ev(`settings.heroStyle={}; buddies.k1.wear={}; bTab="hat"; buddySheet("k1"); true`);
    const off = await get(`(function(){ const out=[]; document.querySelectorAll(".bopt .pill").forEach(p=>{ const r=document.createRange(); r.selectNodeContents(p); const a=r.getBoundingClientRect(), b=p.getBoundingClientRect(); if(a.height) out.push(Math.abs((a.top+a.bottom)/2-(b.top+b.bottom)/2)); }); return out; })()`);
    ok(off.length > 5 && Math.max(...off) <= 2, "coin prices are vertically centered in their pills (largest offset " + Math.max(...off).toFixed(1) + "px over " + off.length + " pills)");
  } catch(e){ fails++; console.log("EXCEPTION "+(e && e.stack || e)); }
  finally { try { ws.close(); } catch(e){} try { proc.kill(); } catch(e){} try { server.close(); } catch(e){} }
  console.log(fails ? "\nFAILED: "+fails+" check(s)" : "\nALL PASS");
  process.exit(fails ? 1 : 0);
}
run();
